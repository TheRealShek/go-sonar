import type { Backend } from './backend';
import type { GraphRequest, GraphView, SourceSpan, ViewNode, ViewEdge } from './shared/protocol';
const source = (line: number): SourceSpan => ({
  file: '/sample/catalog/catalog.go',
  line,
  column: 1,
  endLine: line,
  endColumn: 70,
});
const node = (
  id: string,
  name: string,
  kind: string,
  line: number,
  parentId?: string,
): ViewNode => ({
  id,
  name,
  kind,
  qualifiedName: `catalog.${name}`,
  packageId: 'sample/catalog',
  source: source(line),
  signature: kind === 'function' ? `func ${name}(key string) (Item, error)` : name,
  documentation: '',
  ...(parentId ? { parentId } : {}),
});
const symbols = [
  node('get', 'Get', 'function', 7),
  node('item', 'Item', 'struct', 3),
  node('cache', 'cache', 'variable', 6),
  node('load', 'Load', 'function', 19),
  node('name', 'Name', 'field', 4),
  node('handler', 'Handler', 'function', 23),
];
const edge = (
  id: string,
  from: string,
  to: string,
  kind: string,
  label: string,
  line: number,
): ViewEdge => ({
  id,
  source: from,
  target: to,
  kind,
  label,
  certainty: 'resolved',
  evidence: source(line),
});
const relations = [
  edge('get-load', 'get', 'load', 'calls', 'calls on cache miss', 12),
  edge('get-cache', 'get', 'cache', 'reads', 'reads cached item', 8),
  edge('get-write', 'get', 'cache', 'writes', 'stores loaded item', 16),
  edge('get-item', 'get', 'item', 'uses_type', 'returns Item', 7),
  edge('handler-get', 'handler', 'get', 'calls', 'calls Get', 23),
  edge('load-name', 'load', 'name', 'writes', 'initializes Name', 20),
];
const internals = [
  node('entry', 'Input: key', 'entry', 7, 'get'),
  node('lookup', 'Lookup cache[key]', 'operation', 8, 'get'),
  node('hit', 'Cache hit?', 'condition', 9, 'get'),
  node('cached', 'Return cached item', 'return', 10, 'get'),
  { ...node('fetch', 'Load(key)', 'call', 12, 'get'), relatedSymbolId: 'load' },
  node('error', 'Error returned?', 'condition', 13, 'get'),
  node('failure', 'Return error', 'return', 14, 'get'),
  node('store', 'cache[key] = item', 'operation', 16, 'get'),
  node('result', 'Return loaded item', 'return', 17, 'get'),
];
const control = [
  edge('c1', 'entry', 'lookup', 'control', 'next', 8),
  edge('c2', 'lookup', 'hit', 'control', 'next', 9),
  edge('c3', 'hit', 'cached', 'control', 'true', 10),
  edge('c4', 'hit', 'fetch', 'control', 'false', 12),
  edge('c5', 'fetch', 'error', 'control', 'next', 13),
  edge('c6', 'error', 'failure', 'control', 'true', 14),
  edge('c7', 'error', 'store', 'control', 'false', 16),
  edge('c8', 'store', 'result', 'control', 'next', 17),
  edge('d1', 'fetch', 'store', 'data', 'loaded item', 16),
  edge('cross', 'fetch', 'load', 'calls', 'call target', 12),
];
const text = `package catalog\n\ntype Item struct {\n    Name string\n}\nvar cache = map[string]Item{}\nfunc Get(key string) (Item, error) {\n    item, ok := cache[key]\n    if ok {\n        return item, nil\n    }\n    item, err := Load(key)\n    if err != nil {\n        return Item{}, err\n    }\n    cache[key] = item\n    return item, nil\n}\nfunc Load(key string) (Item, error) {\n    return Item{Name: key}, nil\n}\n\nfunc Handler(key string) { Get(key) }`;
function view(request: GraphRequest): GraphView {
  const ids = new Set([request.focus]);
  const selected: ViewEdge[] = [];
  for (const id of new Set([request.focus, ...request.expanded]))
    for (const relation of relations) {
      const direction = request.direction ?? 'both';
      if (
        request.kinds.includes(relation.kind) &&
        ((direction !== 'incoming' && relation.source === id) ||
          (direction !== 'outgoing' && relation.target === id))
      ) {
        ids.add(relation.source);
        ids.add(relation.target);
        if (!selected.some((edge) => edge.id === relation.id)) selected.push(relation);
      }
    }
  let nodes = symbols.filter((node) => ids.has(node.id));
  if (request.internals.includes('get') && ids.has('get')) {
    nodes = [...nodes, ...internals];
    selected.push(
      ...control.filter(
        (edge) =>
          nodes.some((node) => node.id === edge.source) &&
          nodes.some((node) => node.id === edge.target),
      ),
    );
  }
  const truncated = nodes.length > request.limit;
  nodes = nodes.slice(0, request.limit);
  const shown = new Set(nodes.map((node) => node.id));
  return {
    snapshot: 'sample-v1',
    focus: request.focus,
    nodes,
    edges: selected.filter((edge) => shown.has(edge.source) && shown.has(edge.target)),
    summaries: nodes
      .filter((node) => !node.parentId)
      .map((node) => {
        const connected = relations.filter(
          (edge) => edge.source === node.id || edge.target === node.id,
        );
        return {
          nodeId: node.id,
          incoming: connected.filter((edge) => edge.target === node.id).length,
          outgoing: connected.filter((edge) => edge.source === node.id).length,
          hidden: connected.filter((edge) => !selected.includes(edge)).length,
        };
      }),
    truncated,
  };
}
const summary = {
  root: '/sample/catalog',
  name: 'Sample catalog (illustrative)',
  snapshot: 'sample-v1',
  symbolCount: symbols.length,
  relationCount: relations.length,
  stats: { analyzedPackages: 0, reusedPackages: 0, changedFiles: 0, durationMs: 0 },
  diagnostics: [
    {
      severity: 'warning' as const,
      packageId: 'sample/catalog',
      message: 'Illustrative fixture only. No local project has been analyzed in browser preview.',
    },
  ],
};
export const sampleBackend: Backend = {
  open: async () => summary,
  refresh: async () => summary,
  search: async (query) =>
    symbols
      .filter((node) =>
        `${node.qualifiedName} ${node.kind}`.toLowerCase().includes(query.toLowerCase()),
      )
      .map((node) => ({ ...node, exported: true }))
      .slice(0, 40),
  graph: async (request) => view(request),
  source: async (span) => ({
    file: span.file,
    firstLine: Math.max(1, span.line - 2),
    text: text
      .split('\n')
      .slice(Math.max(0, span.line - 3), span.endLine + 2)
      .join('\n'),
  }),
  impact: async (symbolId, category) =>
    view({
      focus: symbolId,
      expanded: [],
      internals: [],
      kinds:
        category === 'field'
          ? ['reads', 'writes', 'references']
          : category === 'signature'
            ? ['calls', 'uses_type', 'implements', 'references']
            : ['calls', 'reads', 'references'],
      direction: 'incoming',
      limit: 80,
    }),
};
