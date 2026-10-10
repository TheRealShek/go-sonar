import type { GraphRequest, GraphView } from './shared/protocol';

export const RELATIONS = [
  'calls',
  'references',
  'reads',
  'writes',
  'constructs',
  'implements',
  'uses_type',
];

export const VIEW_LIMIT = 80;

export function requestFor(
  focus: string,
  kind = 'function',
  preferences?: Pick<GraphRequest, 'kinds' | 'direction' | 'neighborLimit'>,
): GraphRequest {
  const kinds =
    kind === 'field'
      ? ['reads', 'writes']
      : ['struct', 'type', 'interface'].includes(kind)
        ? ['constructs', 'uses_type', 'implements', 'references']
        : ['calls'];
  return {
    focus,
    expanded: [],
    internals: [],
    kinds,
    limit: VIEW_LIMIT,
    direction:
      kind === 'field' || ['struct', 'type', 'interface'].includes(kind) ? 'incoming' : 'outgoing',
    neighborLimit: 8,
    ...preferences,
  };
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids.slice(-19), id];
}

export class LatestRequest {
  private version = 0;

  next() {
    const version = ++this.version;

    return () => version === this.version;
  }

  invalidate() {
    this.version++;
  }
}

export function validateView(view: GraphView, limit: number): GraphView {
  if (view.nodes.length > limit) throw new Error('Backend exceeded the visible node limit.');

  const ids = new Set(view.nodes.map((node) => node.id));
  if (ids.size !== view.nodes.length)
    throw new Error('Backend returned duplicate node identities.');

  if (
    view.nodes.some((node) => node.parentId && !ids.has(node.parentId)) ||
    view.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))
  )
    throw new Error('Backend returned an incomplete graph boundary.');

  return view;
}

// Pagination counts distinct endpoint/kind connections. Every source occurrence remains inspectable.
export function neighborPage(
  request: GraphRequest,
  nodeId: string,
  page: { pageOffset?: number; pageSize?: number; hasMore?: boolean },
  direction: 'previous' | 'next',
): GraphRequest {
  const offset = page.pageOffset;
  const size = page.pageSize;
  if (
    offset === undefined ||
    size === undefined ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(size) ||
    size <= 0
  )
    return request;

  if ((direction === 'next' && !page.hasMore) || (direction === 'previous' && offset === 0))
    return request;

  const expanded =
    nodeId === request.focus || request.expanded.includes(nodeId)
      ? request.expanded
      : [...request.expanded.slice(-19), nodeId];
  const seeds = new Set([request.focus, ...expanded]);
  const offsets = Object.fromEntries(
    Object.entries(request.offsets ?? {}).filter(([id]) => seeds.has(id)),
  );
  offsets[nodeId] = direction === 'next' ? offset + size : Math.max(0, offset - size);

  return { ...request, expanded, offsets };
}
