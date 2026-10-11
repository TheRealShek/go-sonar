import { BaseEdge, getBezierPath, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { EdgeRoute, Point } from './layout/contract';
import type { GraphView, ViewEdge } from './shared/protocol';

export const relationshipColors: Record<string, string> = {
  control: '#88c0d0',
  data: '#b48ead',
  calls: '#81a1c1',
  references: '#81a1c1',
  reads: '#b48ead',
  writes: '#b48ead',
  constructs: '#81a1c1',
  implements: '#81a1c1',
  uses_type: '#81a1c1',
};

const connectionColors = ['#81a1c1', '#88c0d0', '#a3be8c', '#b48ead', '#ebcb8b', '#d5967a'];

export function connectionColor(id: string, kind: string, label: string) {
  if (['data', 'reads', 'writes'].includes(kind)) return '#b48ead';
  if (kind === 'control') {
    if (['false', 'done'].includes(label)) return '#d5967a';
    if (['true', 'iterate', 'next item'].includes(label)) return '#a3be8c';
    return '#88c0d0';
  }
  if (kind !== 'calls') return relationshipColors[kind] ?? '#81a1c1';
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return connectionColors[hash % connectionColors.length];
}

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

// Return comparison describes the whole route, even though its return node is selected.
export function graphEmphasis(
  selection: { edges: Set<string>; endpoints: Set<string> },
  outcome?: { edges: Set<string>; nodes: Set<string> },
) {
  return outcome ? { edges: outcome.edges, endpoints: outcome.nodes } : selection;
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
            style={{ borderColor: relationshipColors[kind] ?? '#81a1c1' }}
          />
          {relationshipName(kind)}
          {!behavior && kind === 'calls' ? ' · colors trace individual connections' : ''}
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
          <i className="legend-line" style={{ borderColor: '#ebcb8b' }} />
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

function labelPosition(sections: Point[][]): Point {
  let length = -1;
  let midpoint = sections[0][0];
  for (const points of sections) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance > length) {
        length = distance;
        midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
  }
  return midpoint;
}

function RoutedEdge(props: EdgeProps) {
  const curved = props.data?.curved === true;
  const route = curved ? undefined : (props.data?.route as EdgeRoute | undefined);
  const [fallback, x, y] = curved
    ? getBezierPath(props)
    : getSmoothStepPath({ ...props, borderRadius: 0 });
  const path = route
    ? route.sections
        .map((points) => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '))
        .join(' ')
    : fallback;
  const label = route?.label ?? (route ? labelPosition(route.sections) : { x, y });
  return (
    <>
      <BaseEdge
        className="edge-halo"
        path={path}
        style={{ stroke: 'var(--canvas)', strokeWidth: 6 }}
        interactionWidth={0}
      />
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        label={props.label}
        labelX={label.x}
        labelY={label.y}
        labelStyle={props.labelStyle}
        labelBgStyle={props.labelBgStyle}
        interactionWidth={18}
      />
    </>
  );
}

export const edgeTypes = { routed: RoutedEdge };
