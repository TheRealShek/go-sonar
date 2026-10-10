import type { GraphRequest, GraphSummary, GraphView, ViewNode } from './shared/protocol';
import { clearGroup, neighborPage, RELATIONS, toggleId } from './exploration';

export function ConnectionSummary({
  node,
  summary,
  view,
  request,
  busy,
  onChange,
  onRequest,
}: {
  node: ViewNode;
  summary: GraphSummary;
  view: GraphView;
  request: GraphRequest;
  busy: boolean;
  onChange: (updates: Partial<GraphRequest>) => void;
  onRequest: (request: GraphRequest) => void;
}) {
  const shown = view.edges.filter(
    (edge) => RELATIONS.includes(edge.kind) && (edge.source === node.id || edge.target === node.id),
  ).length;
  const sitesShown = Math.max(
    0,
    (summary.sourceSites ?? summary.incoming + summary.outgoing) - summary.hidden,
  );
  const groups = Object.entries(request.groups ?? {});
  return (
    <section className="connection-summary" aria-label="Graph connections">
      <div className="actions">
        <strong>
          {node.name}: {shown} connections shown
        </strong>
        {summary.hidden > 0 && <span>· {summary.hidden} more source sites</span>}
        {!!summary.filtered && <span>· {summary.filtered} hidden by filters</span>}
        {!!summary.collapsed &&
          node.id !== request.focus &&
          !request.expanded.includes(node.id) && (
            <button
              disabled={busy}
              onClick={() => onChange({ expanded: toggleId(request.expanded, node.id) })}
            >
              Reveal neighbors
            </button>
          )}
        {!!summary.filtered && (
          <button
            disabled={busy}
            onClick={() =>
              onChange({
                kinds: [...RELATIONS],
                direction: 'both',
                neighborKind: undefined,
                groups: {},
                offsets: {},
              })
            }
          >
            Reset connection filters
          </button>
        )}
        {(summary.pageOffset ?? 0) > 0 && (
          <button
            disabled={busy}
            onClick={() => onRequest(neighborPage(request, node.id, summary, 'previous'))}
          >
            Previous connections
          </button>
        )}
        {summary.hasMore && (
          <button
            disabled={busy}
            onClick={() => onRequest(neighborPage(request, node.id, summary, 'next'))}
          >
            More connections
          </button>
        )}
      </div>
      {groups.length > 0 && (
        <div className="actions" aria-label="Local connection filters">
          {groups.map(([id, group]) => (
            <button
              key={id}
              disabled={busy}
              className="filter-chip"
              aria-label={`Remove connection filter for ${view.nodes.find((candidate) => candidate.id === id)?.name ?? id}`}
              onClick={() => onRequest(clearGroup(request, id))}
            >
              {view.nodes.find((candidate) => candidate.id === id)?.name ?? id}: {group.direction}{' '}
              {group.kind.replace('_', ' ')} · {group.packageId} ×
            </button>
          ))}
        </div>
      )}
      <details>
        <summary>Connection details</summary>
        <p>
          {sitesShown} source sites shown · {summary.distinctSymbols ?? '?'} distinct symbols.
          Repeated source sites can share a connection.
        </p>
        <p>
          {summary.filtered ?? 0} filtered · {summary.collapsed ?? 0} collapsed or outside a local
          group · {summary.paginated ?? 0} outside this page · {summary.limited ?? 0} outside the
          view budget.
        </p>
        {!!summary.limited && <p>Collapse other branches to make room, or focus this symbol.</p>}
        {!!summary.paginated && !summary.hasMore && (
          <p>Use previous pages to see earlier connections.</p>
        )}
      </details>
    </section>
  );
}
