import { describe, expect, it } from 'vitest';
import {
  bindingPage,
  retainBindingSites,
  BINDING_CACHE_LIMIT,
  BINDING_PAGE_SIZE,
  type BindingCache,
} from './binding';
import { sampleBackend } from './sample';
import { requestFor } from './exploration';

describe('pinned binding occurrences', () => {
  it('bounds long investigations, pages their sites, and reacquires evicted occurrences', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const node = view.nodes.find((node) => node.details?.accesses?.length)!;
    const access = node.details!.accesses![0];
    let cache: BindingCache = { sites: [], evicted: false };
    const reveal = (index: number) =>
      retainBindingSites(cache, access.id, {
        ...view,
        nodes: [
          { ...node, id: `operation-${index}`, details: { ...node.details!, accesses: [access] } },
        ],
      });
    for (let index = 0; index < 1000; index++) {
      cache = reveal(index);
      expect(cache.sites.length).toBeLessThanOrEqual(BINDING_CACHE_LIMIT);
    }
    expect(cache.evicted).toBe(true);
    expect(cache.sites[0].nodeId).toBe('operation-800');
    expect(cache.sites[0]).not.toHaveProperty('node');
    expect(cache.sites[0].access).not.toHaveProperty('symbolId');
    const seen = [];
    for (let offset = 0; offset < cache.sites.length; offset += BINDING_PAGE_SIZE) {
      const page = bindingPage(cache, offset);
      expect(page.sites.length).toBeLessThanOrEqual(BINDING_PAGE_SIZE);
      seen.push(...page.sites);
    }
    expect(seen).toEqual(cache.sites);
    expect(bindingPage(cache, 1000).offset).toBe(180);
    cache = reveal(0);
    expect(cache.sites.at(-1)?.nodeId).toBe('operation-0');
    expect(cache.sites).toHaveLength(BINDING_CACHE_LIMIT);
    cache = reveal(0);
    expect(cache.sites).toHaveLength(BINDING_CACHE_LIMIT);
  });

  it('isolates shadowed bindings and discards occurrences from older snapshots', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const access = view.nodes.flatMap((node) => node.details?.accesses ?? [])[0];
    const cached = retainBindingSites({ sites: [], evicted: false }, access.id, view);
    expect(cached.sites.length).toBeGreaterThan(0);
    expect(retainBindingSites(cached, 'shadowed-binding', view).sites).toEqual([]);
    const changed = retainBindingSites(cached, access.id, { ...view, snapshot: 'new', nodes: [] });
    expect(changed.sites).toEqual([]);
    expect(changed.evicted).toBe(false);
    expect(bindingPage(changed, 180)).toEqual({ offset: 0, sites: [] });
  });
});
