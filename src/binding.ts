import type { Access, GraphView, SourceSpan } from './shared/protocol';
import { sourceKey } from './source';

export const BINDING_CACHE_LIMIT = 200;
export const BINDING_PAGE_SIZE = 20;

export interface BindingOccurrence {
  nodeId: string;
  functionId: string;
  nodeKind: string;
  operationExpression: string;
  operationSource: SourceSpan;
  access: Pick<Access, 'name' | 'kind' | 'expression' | 'source'>;
}

export interface BindingCache {
  snapshot?: string;
  bindingId?: string;
  sites: BindingOccurrence[];
  evicted: boolean;
}

export function retainBindingSites(
  previous: BindingCache,
  bindingId: string,
  view: GraphView,
): BindingCache {
  const same = previous.snapshot === view.snapshot && previous.bindingId === bindingId;
  const sites = new Map<string, BindingOccurrence>();
  const key = (site: BindingOccurrence) =>
    `${site.nodeId}:${site.access.kind}:${sourceKey(site.access.source)}`;
  if (same) for (const site of previous.sites) sites.set(key(site), site);
  let evicted = same && previous.evicted;
  for (const node of view.nodes) {
    if (!node.parentId) continue;
    for (const access of node.details?.accesses ?? []) {
      if (access.id !== bindingId) continue;
      const site: BindingOccurrence = {
        nodeId: node.id,
        functionId: node.parentId,
        nodeKind: node.kind,
        operationExpression: node.details?.expression || node.name,
        operationSource: node.source,
        access: {
          name: access.name,
          kind: access.kind,
          expression: access.expression,
          source: access.source,
        },
      };
      sites.delete(key(site));
      sites.set(key(site), site);
      if (sites.size > BINDING_CACHE_LIMIT) {
        sites.delete(sites.keys().next().value!);
        evicted = true;
      }
    }
  }
  return { snapshot: view.snapshot, bindingId, sites: [...sites.values()], evicted };
}

export function bindingPage(cache: BindingCache, offset: number) {
  const start = Math.max(
    0,
    Math.min(
      offset,
      Math.floor(Math.max(0, cache.sites.length - 1) / BINDING_PAGE_SIZE) * BINDING_PAGE_SIZE,
    ),
  );
  return { offset: start, sites: cache.sites.slice(start, start + BINDING_PAGE_SIZE) };
}
