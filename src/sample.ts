import type { Backend } from './backend';
import type {
  GraphRequest,
  GraphView,
  SourceSpan,
  ViewNode,
  ViewEdge,
  OperationFacts,
} from './shared/protocol';

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
  { ...node('load', 'Load', 'function', 21), signature: 'func Load(key string) (Item, error)' },
  node('name', 'Name', 'field', 4),
  node('handler', 'Handler', 'function', 26),
  {
    ...node('normalize', 'Normalize', 'function', 23),
    signature: 'func Normalize(item Item) Item',
  },
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
  expression: label,
  siteCount: 1,
});

const relations = [
  edge('get-load', 'get', 'load', 'calls', 'Load(key)', 12),
  edge('get-normalize', 'get', 'normalize', 'calls', 'Normalize(item)', 16),
  edge('get-cache', 'get', 'cache', 'reads', 'reads cached item', 8),
  edge('get-write', 'get', 'cache', 'writes', 'cache[key] = item', 17),
  edge('get-item', 'get', 'item', 'uses_type', 'returns Item', 7),
  edge('handler-get', 'handler', 'get', 'calls', 'Get(key)', 26),
  edge('handler-get-again', 'handler', 'get', 'calls', 'Get(key)', 27),
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
  { ...node('normalizing', 'Normalize(item)', 'call', 16, 'get'), relatedSymbolId: 'normalize' },
  node('normalized', 'item = Normalize(item)', 'operation', 16, 'get'),
  node('store', 'cache[key] = item', 'operation', 17, 'get'),
  node('result', 'return item, nil', 'return', 18, 'get'),
  node('exit', 'exit', 'exit', 19, 'get'),
];

const control = [
  edge('c1', 'entry', 'lookup', 'control', 'next', 8),
  edge('c2', 'lookup', 'hit', 'control', 'next', 9),
  edge('c3', 'hit', 'cached', 'control', 'true', 10),
  edge('c4', 'hit', 'fetch', 'control', 'false', 12),
  edge('c5', 'fetch', 'error', 'control', 'next', 13),
  edge('c6', 'error', 'failure', 'control', 'true', 14),
  edge('c7', 'error', 'normalizing', 'control', 'false', 16),
  edge('c7a', 'normalizing', 'normalized', 'control', '', 16),
  edge('c7b', 'normalized', 'store', 'control', '', 17),
  edge('c8', 'store', 'result', 'control', 'next', 17),
  edge('end1', 'cached', 'exit', 'control', 'return', 10),
  edge('end2', 'failure', 'exit', 'control', 'return', 14),
  edge('end3', 'result', 'exit', 'control', 'return', 18),
  edge('cross', 'fetch', 'load', 'calls', 'call target', 12),
  edge('cross-normalize', 'normalizing', 'normalize', 'calls', 'call target', 16),
];

const text = `package catalog

type Item struct {
    Name string
}
var cache = map[string]Item{}
func Get(key string) (Item, error) {
    item, ok := cache[key]
    if ok {
        return item, nil
    }
    item, err := Load(key)
    if err != nil {
        return Item{}, err
    }
    item = Normalize(item)
    cache[key] = item
    return item, nil
}
func Load(key string) (Item, error) {
    return Item{Name: key}, nil
}

func Normalize(item Item) Item {
    item.Name = "value:" + item.Name
    return item
}
func Handler(key string) { Get(key)
    Get(key) }`;

const expressions: Record<string, string> = {
  entry: 'entry',
  lookup: 'item, ok := cache[key]',
  hit: 'ok',
  cached: 'return item, nil',
  fetch: 'Load(key)',
  error: 'err != nil',
  failure: 'return Item{}, err',
  normalizing: 'Normalize(item)',
  normalized: 'item = Normalize(item)',
  store: 'cache[key] = item',
  result: 'return item, nil',
  exit: 'exit',
};
for (const node of internals) {
  const expression = expressions[node.id];
  node.details = {
    role: node.kind,
    expression,
    explanation:
      node.kind === 'condition'
        ? `This checks ${expression}. Choose a source-defined branch.`
        : node.kind === 'return'
          ? `This returns ${expression}.`
          : `This performs ${expression}.`,
  };
}
const callable = (
  expression: string,
  parameter: string,
  type: string,
  resultType: string,
  destination: string,
): OperationFacts => ({
  role: 'call',
  expression,
  explanation: `This invokes ${expression}.`,
  call: {
    signature: `func(${parameter} ${type}) ${resultType}`,
    dispatch: 'direct',
    arguments: [
      {
        position: 1,
        parameter,
        type,
        expression: parameter === 'item' ? 'item' : 'key',
        spread: false,
      },
    ],
    results: [{ position: 1, type: resultType, destination }],
    variadic: false,
  },
});
internals.find((node) => node.id === 'normalizing')!.details = callable(
  'Normalize(item)',
  'item',
  'Item',
  'Item',
  'item',
);
internals.find((node) => node.id === 'fetch')!.details = {
  ...callable('Load(key)', 'key', 'string', 'Item', 'item'),
  call: {
    ...callable('Load(key)', 'key', 'string', 'Item', 'item').call!,
    results: [
      { position: 1, type: 'Item', destination: 'item' },
      { position: 2, type: 'error', destination: 'err' },
    ],
  },
};
internals.find((node) => node.id === 'store')!.details!.accesses = [
  {
    id: 'cache',
    name: 'cache',
    kind: 'write',
    expression: 'cache[key]',
    source: source(17),
    symbolId: 'cache',
    mutation: 'update indexed element; the container binding is retained',
  },
];
const normalizeInternals = [
  node('normalize-entry', 'entry', 'entry', 23, 'normalize'),
  node('normalize-write', 'item.Name = "value:" + item.Name', 'operation', 24, 'normalize'),
  node('normalize-return', 'return item', 'return', 25, 'normalize'),
  node('normalize-exit', 'exit', 'exit', 26, 'normalize'),
];
for (const node of normalizeInternals)
  node.details = {
    role: node.kind,
    expression: node.name,
    explanation: `This performs ${node.name}.`,
  };
const normalizeControl = [
  edge('nc1', 'normalize-entry', 'normalize-write', 'control', '', 24),
  edge('nc2', 'normalize-write', 'normalize-return', 'control', '', 25),
  edge('nc3', 'normalize-return', 'normalize-exit', 'control', 'return', 25),
];

function view(request: GraphRequest): GraphView {
  const ids = new Set([request.focus]);
  const selected: ViewEdge[] = [];

  const seeds = new Set([request.focus, ...request.expanded]);
  const pageSize = Math.max(1, Math.min(40, request.neighborLimit ?? 8));
  const pages = new Map<string, ViewEdge[]>();
  const allowed = (relation: ViewEdge, id: string) => {
    const group = request.groups?.[id];
    const direction = group?.direction || request.direction || 'both';
    const kinds = group?.kind ? [group.kind] : request.kinds;
    const other = symbols.find(
      (symbol) => symbol.id === (relation.source === id ? relation.target : relation.source),
    );
    return (
      kinds.includes(relation.kind) &&
      ((direction !== 'incoming' && relation.source === id) ||
        (direction !== 'outgoing' && relation.target === id)) &&
      (!group?.packageId || other?.packageId === group.packageId) &&
      (id !== request.focus ||
        group ||
        !request.neighborKind ||
        other?.kind === request.neighborKind)
    );
  };
  for (const id of seeds) {
    const connections: ViewEdge[] = [];
    for (const relation of relations.filter((relation) => allowed(relation, id))) {
      const connection = connections.find(
        (edge) =>
          edge.source === relation.source &&
          edge.target === relation.target &&
          edge.kind === relation.kind,
      );
      const site = {
        id: relation.id,
        expression: relation.expression ?? relation.label,
        evidence: relation.evidence,
        certainty: relation.certainty,
      };
      if (!connection) connections.push({ ...relation, sites: [site], siteCount: 1 });
      else {
        connection.sites!.push(site);
        connection.siteCount = connection.sites!.length;
        connection.label = `${relation.kind} · ${connection.siteCount} source sites`;
      }
    }
    pages.set(id, connections);
    const offset = request.offsets?.[id] ?? 0;
    for (const connection of connections.slice(offset, offset + pageSize)) {
      ids.add(connection.source);
      ids.add(connection.target);
      if (!selected.some((edge) => edge.id === connection.id)) selected.push(connection);
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

  if (request.internals.includes('normalize') && ids.has('normalize')) {
    nodes = [...nodes, ...normalizeInternals];
    selected.push(...normalizeControl);
  }
  const truncated = nodes.length > request.limit;
  nodes = nodes.slice(0, request.limit);
  const shown = new Set(nodes.map((node) => node.id));
  const visibleEdges = selected.filter((edge) => shown.has(edge.source) && shown.has(edge.target));

  return {
    snapshot: 'sample-v1',
    focus: request.focus,
    nodes,
    edges: visibleEdges,
    summaries: nodes
      .filter((node) => !node.parentId)
      .map((node) => {
        const connected = relations.filter(
          (edge) => edge.source === node.id || edge.target === node.id,
        );

        const hidden = connected.filter(
          (edge) => !visibleEdges.some((value) => value.sites?.some((site) => site.id === edge.id)),
        );
        const group = request.groups?.[node.id];
        const groupMatches = (edge: ViewEdge) =>
          !group ||
          ((!group.kind || group.kind === edge.kind) &&
            (!group.direction ||
              group.direction === (edge.source === node.id ? 'outgoing' : 'incoming')) &&
            (!group.packageId || group.packageId === 'sample/catalog'));
        const filtered = hidden.filter((edge) => {
          if (group && groupMatches(edge)) return false;
          const direction = request.direction || 'both';
          const kinds = request.kinds;
          const other = symbols.find(
            (symbol) => symbol.id === (edge.source === node.id ? edge.target : edge.source),
          );
          return (
            !kinds.includes(edge.kind) ||
            (direction === 'incoming' && edge.source === node.id) ||
            (direction === 'outgoing' && edge.target === node.id) ||
            (node.id === request.focus &&
              !group &&
              !!request.neighborKind &&
              other?.kind !== request.neighborKind)
          );
        }).length;
        const collapsed = Math.min(
          hidden.length - filtered,
          hidden.filter((edge) => !seeds.has(node.id) || (!!group && !groupMatches(edge))).length,
        );
        return {
          nodeId: node.id,
          sourceSites: connected.length,
          pageOffset: seeds.has(node.id) ? (request.offsets?.[node.id] ?? 0) : undefined,
          pageSize: seeds.has(node.id) ? pageSize : undefined,
          hasMore: (pages.get(node.id)?.length ?? 0) > (request.offsets?.[node.id] ?? 0) + pageSize,
          incoming: connected.filter((edge) => edge.target === node.id).length,
          outgoing: connected.filter((edge) => edge.source === node.id).length,
          hidden: hidden.length,
          distinctSymbols: new Set(
            connected.map((edge) => (edge.source === node.id ? edge.target : edge.source)),
          ).size,
          filtered,
          collapsed,
          paginated: Math.max(0, hidden.length - filtered - collapsed),
          limited: 0,
          groups: [
            ...new Set(
              connected.map(
                (edge) => `${edge.kind}:${edge.source === node.id ? 'outgoing' : 'incoming'}`,
              ),
            ),
          ].map((key) => {
            const [kind, direction] = key.split(':');
            const edges = connected.filter(
              (edge) =>
                edge.kind === kind &&
                (direction === 'outgoing' ? edge.source === node.id : edge.target === node.id),
            );
            return {
              packageId: 'sample/catalog',
              kind,
              direction,
              sites: edges.length,
              symbols: new Set(
                edges.map((edge) => (edge.source === node.id ? edge.target : edge.source)),
              ).size,
              visible: edges.filter((edge) =>
                visibleEdges.some((value) => value.sites?.some((site) => site.id === edge.id)),
              ).length,
              filtered:
                !(group?.kind ? [group.kind] : request.kinds).includes(kind) ||
                (!!(group?.direction || request.direction) &&
                  (group?.direction || request.direction) !== 'both' &&
                  (group?.direction || request.direction) !== direction),
            };
          }),
        };
      }),
    truncated,
    behaviors: request.internals
      .filter((id) => ids.has(id))
      .map((id) => {
        const internal = id === 'get' ? internals : id === 'normalize' ? normalizeInternals : [];
        const returns = internal.filter((node) => node.kind === 'return');
        return {
          symbolId: id,
          entryId: internal.find((node) => node.kind === 'entry')?.id,
          totalNodes: internal.length,
          hiddenNodes: 0,
          returns,
          returnCount: returns.length,
          returnOffset: 0,
          incomplete: !internal.length,
        };
      }),
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
  browse: async (kind, packageId, offset) => {
    const filtered = symbols.filter(
      (node) => (!kind || node.kind === kind) && (!packageId || node.packageId === packageId),
    );
    return {
      symbols: filtered.slice(offset, offset + 40).map((node) => ({ ...node, exported: true })),
      total: filtered.length,
      offset,
    };
  },
  discovery: async () => ({ entrypoints: [], packages: ['sample/catalog'], packageCount: 1 }),
  relationSites: async (from, to, kind, offset) => {
    const sites = relations.filter(
      (edge) => edge.source === from && edge.target === to && edge.kind === kind,
    );
    return {
      snapshot: 'sample-v1',
      sites: sites.slice(offset, offset + 40).map((edge) => ({
        id: edge.id,
        expression: edge.expression ?? edge.label,
        evidence: edge.evidence,
        certainty: edge.certainty,
      })),
      total: sites.length,
      offset,
    };
  },
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
