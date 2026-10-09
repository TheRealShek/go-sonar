import { invoke } from '@tauri-apps/api/core';
import type {
  GraphRequest,
  GraphView,
  ProjectSummary,
  SourceExcerpt,
  SourceSpan,
  SymbolFact,
} from './shared/protocol';
import { sampleBackend } from './sample';
import { QueryQueue } from './requests';
import type { BenchmarkConfig, BenchmarkReport } from './benchmark';

export const isDesktop = '__TAURI_INTERNALS__' in window;

export interface Backend {
  open(root: string): Promise<ProjectSummary>;
  refresh(): Promise<ProjectSummary>;
  search(query: string): Promise<SymbolFact[]>;
  graph(request: GraphRequest): Promise<GraphView>;
  source(source: SourceSpan): Promise<SourceExcerpt>;
  impact(symbolId: string, category: string): Promise<GraphView>;
}

const transport: Backend = isDesktop
  ? {
      open: (root) => invoke('open_project', { root }),
      refresh: () => invoke('refresh_project'),
      search: (query) => invoke('search_symbols', { query, limit: 40 }),
      graph: (request) => invoke('graph_view', { request }),
      source: (source) => invoke('source_excerpt', { source }),
      impact: (symbolId, category) => invoke('impact_view', { symbolId, category, limit: 80 }),
    }
  : sampleBackend;

const views = new QueryQueue<GraphView>();
const searches = new QueryQueue<SymbolFact[]>();

export const backend: Backend = {
  ...transport,
  graph: (request) => views.execute(() => transport.graph(request)),
  impact: (symbolId, category) => views.execute(() => transport.impact(symbolId, category)),
  search: (query) => searches.execute(() => transport.search(query)),
};

export const benchmarkConfig = (): Promise<BenchmarkConfig | null> =>
  isDesktop ? invoke('benchmark_config') : Promise.resolve(null);

export const benchmarkReport = (report: BenchmarkReport): Promise<void> =>
  isDesktop
    ? invoke('benchmark_report', { report })
    : Promise.reject(new Error('Native benchmark requires desktop mode'));
