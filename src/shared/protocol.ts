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
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  certainty: 'resolved' | 'possible';
  evidence: SourceSpan;
}

export interface GraphSummary {
  nodeId: string;
  incoming: number;
  outgoing: number;
  hidden: number;
  pageOffset?: number;
  pageSize?: number;
  hasMore?: boolean;
}

export interface GraphView {
  snapshot: string;
  focus: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  summaries: GraphSummary[];
  truncated: boolean;
}

export interface GraphRequest {
  focus: string;
  expanded: string[];
  internals: string[];
  kinds: string[];
  limit: number;
  direction?: 'incoming' | 'outgoing' | 'both';
  offsets?: Record<string, number>;
}

export interface SourceExcerpt {
  file: string;
  firstLine: number;
  text: string;
}
