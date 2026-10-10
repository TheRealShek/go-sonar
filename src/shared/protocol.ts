export interface SourceSpan {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface SymbolFact {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  packageId: string;
  source: SourceSpan;
  signature: string;
  documentation: string;
  exported: boolean;
}

export interface AnalysisStats {
  analyzedPackages: number;
  reusedPackages: number;
  changedFiles: number;
  durationMs: number;
}

export interface Diagnostic {
  message: string;
  packageId: string;
  severity: 'warning' | 'error';
}

export interface ProjectSummary {
  root: string;
  name: string;
  snapshot: string;
  symbolCount: number;
  relationCount: number;
  stats: AnalysisStats;
  diagnostics: Diagnostic[];
}

export interface ViewNode extends Omit<SymbolFact, 'exported'> {
  parentId?: string;
  relatedSymbolId?: string;
  details?: OperationFacts;
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  certainty: 'resolved' | 'possible';
  evidence: SourceSpan;
  expression?: string;
  sites?: RelationSite[];
  siteCount?: number;
  loopBack?: boolean;
  hiddenTargetId?: string;
}

export interface GraphSummary {
  nodeId: string;
  incoming: number;
  outgoing: number;
  hidden: number;
  pageOffset?: number;
  pageSize?: number;
  hasMore?: boolean;
  distinctSymbols?: number;
  sourceSites?: number;
  filtered?: number;
  collapsed?: number;
  paginated?: number;
  limited?: number;
  groups?: NeighborGroup[];
  moreGroups?: number;
}

export interface GraphView {
  snapshot: string;
  focus: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  summaries: GraphSummary[];
  truncated: boolean;
  behaviors?: BehaviorSummary[];
}

export interface GraphRequest {
  focus: string;
  expanded: string[];
  internals: string[];
  kinds: string[];
  limit: number;
  direction?: 'incoming' | 'outgoing' | 'both';
  offsets?: Record<string, number>;
  neighborLimit?: number;
  neighborKind?: 'method';
  groups?: Record<string, NeighborFilter>;
  regions?: string[];
  behaviorAnchors?: Record<string, string>;
  outcomeOffsets?: Record<string, number>;
}

export interface SourceExcerpt {
  file: string;
  firstLine: number;
  text: string;
}

export interface RelationSite {
  id: string;
  expression: string;
  evidence: SourceSpan;
  certainty: 'resolved' | 'possible';
}

export interface RelationSites {
  snapshot: string;
  sites: RelationSite[];
  total: number;
  offset: number;
}

export interface NeighborFilter {
  packageId: string;
  kind: string;
  direction: string;
}

export interface NeighborGroup extends NeighborFilter {
  sites: number;
  symbols: number;
  visible: number;
  filtered: boolean;
}

export interface OperationFacts {
  role: string;
  expression: string;
  explanation: string;
  limitation?: string;
  call?: CallBoundary;
  accesses?: Access[];
  region?: { firstNodeId: string; nodeCount: number; calls: number; operations: number };
  join?: boolean;
}

export interface CallBoundary {
  signature: string;
  receiver?: string;
  dispatch: 'direct' | 'interface' | 'dynamic';
  arguments: {
    position: number;
    parameter: string;
    type: string;
    expression: string;
    spread: boolean;
    variadic?: boolean;
  }[];
  results: { position: number; type: string; destination: string }[];
  variadic: boolean;
}

export interface Access {
  id: string;
  name: string;
  kind: string;
  expression: string;
  source: SourceSpan;
  symbolId?: string;
  mutation?: string;
}

export interface BehaviorSummary {
  symbolId: string;
  entryId?: string;
  totalNodes: number;
  hiddenNodes: number;
  returns: ViewNode[];
  returnCount: number;
  returnOffset: number;
  incomplete: boolean;
}

export interface SymbolPage {
  symbols: SymbolFact[];
  total: number;
  offset: number;
}

export interface Discovery {
  entrypoints: SymbolFact[];
  packages: string[];
  packageCount: number;
}
