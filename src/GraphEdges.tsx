import type { GraphView, ViewEdge } from './shared/protocol';

export const relationshipColors: Record<string, string> = {
  control: '#277e88',
  data: '#8650b1',
  calls: '#52647d',
  references: '#52647d',
  reads: '#8650b1',
  writes: '#8650b1',
  constructs: '#52647d',
  implements: '#52647d',
  uses_type: '#52647d',
};

export function relationshipName(kind: string): string {
  return kind.replaceAll('_', ' ');
}

export function edgeLabel(edge: ViewEdge): string {
  const label =
    edge.kind === 'control' ? edge.label || 'source order' : relationshipName(edge.kind);
  return `${edge.certainty === 'possible' ? '? possible · ' : ''}${label}${edge.loopBack ? ' · ↺ loop back' : ''}${(edge.siteCount ?? 0) > 1 ? ` · ${edge.siteCount} source sites` : ''}`;
}

export function selectionConnections(view: GraphView | undefined, selectedId?: string) {
  const edges = new Set<string>();
  const endpoints = new Set<string>();
  if (!view || !selectedId) return { edges, endpoints };
  const selectedEdge = view.edges.find((edge) => edge.id === selectedId);
  for (const edge of view.edges) {
    if (
      selectedEdge
        ? edge.id === selectedId
        : edge.source === selectedId || edge.target === selectedId
    ) {
      edges.add(edge.id);
      endpoints.add(edge.source);
      endpoints.add(edge.target);
    }
  }
  if (!selectedEdge) endpoints.add(selectedId);
  return { edges, endpoints };
}

export function GraphLegend({ view }: { view: GraphView }) {
  const kinds = [...new Set(view.edges.map((edge) => edge.kind))];
  const behavior = !!view.behaviors?.length;
  return (
    <div
      className="graph-legend"
      aria-label={behavior ? 'Flow graph legend' : 'Relationship graph legend'}
    >
      <strong>{behavior ? 'Flow' : 'Relationships'}</strong>
      {kinds.map((kind) => (
        <span key={kind}>
          <i
            className="legend-line"
            style={{ borderColor: relationshipColors[kind] ?? '#52647d' }}
          />
          {relationshipName(kind)}
          {kind === 'control' ? ' · source order' : ''}
        </span>
      ))}
      {view.edges.some((edge) => edge.certainty === 'possible') && (
        <span>
          <i className="legend-line possible" />? possible · unresolved
        </span>
      )}
      {view.edges.some((edge) => edge.loopBack) && <span>↺ solid return route · loop back</span>}
      {behavior && (
        <span>
          <i className="legend-line" style={{ borderColor: '#d88819' }} />
          Next step
        </span>
      )}
      {view.edges.some((edge) => (edge.siteCount ?? 0) > 1) && (
        <span>N source sites · repeated source occurrences</span>
      )}
      <span className="muted">
        Arrows show direction.{' '}
        {behavior ? 'Static paths; execution is unknown.' : 'Placement has no execution order.'}
      </span>
    </div>
  );
}
