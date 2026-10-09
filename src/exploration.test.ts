import { describe, expect, it } from 'vitest';
import {
  LatestRequest,
  requestFor,
  toggleId,
  validateView,
  VIEW_LIMIT,
  neighborPage,
} from './exploration';
import { sampleBackend } from './sample';
import { calculateLayout } from './layout/engine';
import ELK from 'elkjs/lib/elk.bundled.js';
const testElk = new ELK();
describe('bounded disclosure', () => {
  it('starts collapsed and only opens requested behavior', async () => {
    const request = requestFor('get');
    expect(request.internals).toEqual([]);
    const collapsed = await sampleBackend.graph(request);
    expect(collapsed.nodes.every((node) => !node.parentId)).toBe(true);
    const opened = await sampleBackend.graph({ ...request, internals: ['get'] });
    expect(opened.nodes.some((node) => node.parentId === 'get')).toBe(true);
    expect(validateView(opened, VIEW_LIMIT)).toBe(opened);
    const again = await sampleBackend.graph(request);
    expect(again.nodes).toEqual(collapsed.nodes);
  });
  it('queries only the requested direction and filters while retaining hidden counts', async () => {
    const incoming = await sampleBackend.graph({ ...requestFor('get'), direction: 'incoming' });
    expect(incoming.edges.map((edge) => edge.id)).toEqual(['handler-get']);
    expect(incoming.summaries.find((summary) => summary.nodeId === 'get')!.hidden).toBeGreaterThan(
      0,
    );
    const filtered = await sampleBackend.graph({ ...requestFor('get'), kinds: [] });
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.edges).toHaveLength(0);
  });
  it('bounds history expansions and reuses identities through cycles', () => {
    let ids: string[] = [];
    for (let index = 0; index < 50; index++) ids = toggleId(ids, String(index));
    expect(ids).toHaveLength(20);
    expect(toggleId(ids, '49')).not.toContain('49');
  });
  it('rejects dangling boundary connections and oversized renderer responses', async () => {
    const view = await sampleBackend.graph(requestFor('get'));
    expect(() => validateView(view, 1)).toThrow('limit');
    expect(() =>
      validateView({ ...view, nodes: view.nodes.filter((node) => node.id !== 'get') }, VIEW_LIMIT),
    ).toThrow('boundary');
  });
});
describe('async request publication', () => {
  it('prevents old source/query/layout responses replacing a new request', () => {
    const gate = new LatestRequest();
    const first = gate.next();
    const second = gate.next();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    gate.invalidate();
    expect(second()).toBe(false);
  });
});
describe('replaceable layout contract', () => {
  it('groups behavior using relative geometry and routes a cross-boundary edge', async () => {
    const result = await calculateLayout(
      {
        nodes: [
          { id: 'function', width: 650, height: 450 },
          { id: 'operation', width: 220, height: 88, parentId: 'function' },
          { id: 'callee', width: 220, height: 88 },
        ],
        edges: [{ id: 'call', source: 'operation', target: 'callee' }],
      },
      testElk,
    );
    expect(Object.keys(result.positions)).toHaveLength(3);
    expect(result.positions.operation.x).toBeGreaterThanOrEqual(0);
    expect(result.sizes.function.width).toBeGreaterThan(result.sizes.operation.width);
    expect(Number.isFinite(result.positions.callee.x)).toBe(true);
  });
  it('retains existing positions for stable leaf dimensions', async () => {
    const result = await calculateLayout(
      { nodes: [{ id: 'a', width: 220, height: 88, position: { x: 30, y: 80 } }], edges: [] },
      testElk,
    );
    expect(result.positions.a).toEqual({ x: 30, y: 80 });
  });
});

describe('neighbor relation-site pagination', () => {
  it('advances a selected neighbor seed without changing filters, internals, or limits', () => {
    const request = { ...requestFor('get'), internals: ['get'], offsets: { get: 40 } };
    const next = neighborPage(
      request,
      'load',
      { pageOffset: 0, pageSize: 40, hasMore: true },
      'next',
    );
    expect(next.offsets).toEqual({ get: 40, load: 40 });
    expect(next.expanded).toEqual(['load']);
    expect(next.internals).toEqual(['get']);
    expect(next.kinds).toEqual(request.kinds);
    expect(next.limit).toBe(VIEW_LIMIT);
    expect(request.offsets).toEqual({ get: 40 });
  });
  it('preserves history snapshots and returns to a prior page using backend offsets', () => {
    const first = requestFor('get');
    const second = neighborPage(
      first,
      'get',
      { pageOffset: 0, pageSize: 40, hasMore: true },
      'next',
    );
    expect(second.expanded).toEqual([]);
    expect(second.offsets?.get).toBe(40);
    expect(first.offsets).toBeUndefined();
    expect(
      neighborPage(second, 'get', { pageOffset: 40, pageSize: 40, hasMore: false }, 'previous')
        .offsets?.get,
    ).toBe(0);
    expect(
      neighborPage(second, 'get', { pageOffset: 40, pageSize: 40, hasMore: false }, 'next'),
    ).toBe(second);
    expect(neighborPage(first, 'get', { pageOffset: 0, pageSize: 40 }, 'previous')).toBe(first);
  });
  it('rejects invalid metadata and bounds paging state with expansion seeds', () => {
    const first = requestFor('get');
    expect(neighborPage(first, 'get', { pageOffset: 0, pageSize: 0, hasMore: true }, 'next')).toBe(
      first,
    );
    const expanded = Array.from({ length: 20 }, (_, index) => String(index));
    const next = neighborPage(
      { ...first, expanded, offsets: { '0': 40, '19': 80, obsolete: 200 } },
      'new',
      { pageOffset: 0, pageSize: 40, hasMore: true },
      'next',
    );
    expect(next.expanded).toHaveLength(20);
    expect(next.expanded).not.toContain('0');
    expect(next.offsets).toEqual({ '19': 80, new: 40 });
  });
});
