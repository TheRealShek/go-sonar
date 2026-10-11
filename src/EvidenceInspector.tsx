import { useEffect, useState } from 'react';
import { backend } from './backend';
import { SourcePanel } from './SourcePanel';
import { sourceKey } from './source';
import { formatSource } from './GraphCards';
import { symbolName, nodeName } from './identity';
import type {
  Access,
  GraphRequest,
  GraphSummary,
  GraphView,
  RelationSite,
  SourceExcerpt,
  SourceSpan,
  ViewEdge,
  ViewNode,
  NeighborFilter,
} from './shared/protocol';
import { canEnterCall, MAX_CALL_DEPTH } from './navigation';

export function EvidenceInspector({
  selected,
  summary,
  view,
  request,
  root,
  busy,
  impact,
  excerpt,
  evidence,
  sourceLoading,
  sourceError,
  onRetrySource,
  onRefreshSource,
  binding,
  onBinding,
  onDismissBinding,
  onOccurrence,
  callDepth,
  onFocus,
  onUsage,
  onChange,
  onEnter,
  onFollow,
  onReveal,
  onSelect,
  onSource,
  onImpact,
  onPage,
  onShow,
  onGroup,
  onClearGroup,
}: {
  selected?: ViewNode | ViewEdge;
  summary?: GraphSummary;
  view?: GraphView;
  request?: GraphRequest;
  root?: string;
  busy: boolean;
  impact: string;
  excerpt?: SourceExcerpt;
  evidence?: SourceSpan;
  sourceLoading: boolean;
  sourceError: string;
  onRetrySource: () => void;
  onRefreshSource: () => void;
  binding?: Access;
  onBinding: (access: Access) => void;
  onDismissBinding: () => void;
  onOccurrence: (node: ViewNode, span: SourceSpan) => void;
  callDepth: number;
  onFocus: (id: string, kind?: string) => void;
  onUsage: (id: string) => void;
  onChange: (updates: Partial<GraphRequest>) => void;
  onEnter: (node: ViewNode) => void;
  onFollow: (id: string) => void;
  onReveal: (node: ViewNode) => void;
  onSelect: (value: ViewNode | ViewEdge) => void;
  onSource: (span: SourceSpan) => void;
  onImpact: (id: string, category: string) => void;
  onPage: (direction: 'previous' | 'next') => void;
  onShow: (node: ViewNode) => void;
  onGroup: (nodeId: string, group: NeighborFilter) => void;
  onClearGroup: (nodeId: string) => void;
}) {
  const [sites, setSites] = useState<RelationSite[]>([]);
  const [siteOffset, setSiteOffset] = useState(0);
  const [siteError, setSiteError] = useState('');
  const [sitesBusy, setSitesBusy] = useState(false);
  const edge = selected && 'evidence' in selected ? selected : undefined;
  const node = selected && 'name' in selected ? selected : undefined;
  useEffect(() => {
    setSiteOffset(0);
  }, [selected?.id, view?.snapshot]);
  useEffect(() => {
    let active = true;
    setSites(edge?.sites ?? []);
    setSiteError('');
    if (!edge || !edge.siteCount || edge.siteCount <= (edge.sites?.length ?? 0)) {
      setSitesBusy(false);
      return;
    }
    setSitesBusy(true);
    void backend
      .relationSites(edge.source, edge.target, edge.kind, siteOffset)
      .then((page) => {
        if (!active) return;
        if (page.snapshot !== view?.snapshot) {
          setSiteError('Source sites changed. Refresh the project.');
          return;
        }
        setSites(page.sites);
      })
      .catch((error) => {
        if (active) setSiteError(String(error));
      })
      .finally(() => {
        if (active) setSitesBusy(false);
      });
    return () => {
      active = false;
    };
  }, [edge?.id, edge?.siteCount, siteOffset, view?.snapshot]);
  const source = node?.source ?? edge?.evidence;
  const localSource =
    source &&
    !!source.file &&
    source.line > 0 &&
    (!root || source.file.startsWith(root.endsWith('/') ? root : `${root}/`));
  const callers =
    node && !localSource
      ? view?.edges.filter((edge) => edge.target === node.id && edge.kind === 'calls')
      : [];
  const call = node?.details?.call;
  const [knownSites, setKnownSites] = useState<{
    snapshot?: string;
    sites: { node: ViewNode; access: Access }[];
  }>({ sites: [] });
  useEffect(() => {
    if (!binding) {
      setKnownSites({ sites: [] });
      return;
    }
    if (!view) return;
    setKnownSites((previous) => {
      const sites = new Map<string, { node: ViewNode; access: Access }>();
      const candidates = view.nodes.flatMap((node) =>
        (node.details?.accesses ?? []).map((access) => ({ node, access })),
      );
      for (const site of [
        ...(previous.snapshot === view.snapshot ? previous.sites : []),
        ...candidates,
      ]) {
        if (site.access.id === binding.id)
          sites.set(`${site.node.id}:${site.access.kind}:${sourceKey(site.access.source)}`, site);
      }
      return { snapshot: view.snapshot, sites: [...sites.values()] };
    });
  }, [binding?.id, view?.snapshot, view?.nodes]);
  const localSites = knownSites.sites.filter((site) => site.access.id === binding?.id);
  const sourceContent = (
    <>
      {source && <p className="source-location">{formatSource(source)}</p>}
      {source && localSource ? (
        <button onClick={() => onSource(source)}>Open source evidence</button>
      ) : (
        <>
          <p className="notice">
            Declaration source is unavailable or outside this project. Inspect a local call site
            instead.
          </p>
          {callers?.map((edge) => (
            <button className="match" key={edge.id} onClick={() => onSelect(edge)}>
              Local call from {view?.nodes.find((node) => node.id === edge.source)?.name} · line{' '}
              {edge.evidence.line}
            </button>
          ))}
        </>
      )}
    </>
  );
  return (
    <>
      <h2>Context & evidence</h2>
      {!!view?.nodes.length && (
        <details className="keyboard-browser">
          <summary>Inspect the graph with the keyboard</summary>
          <label>
            Visible operation or symbol
            <select
              value={node?.id ?? ''}
              onChange={(event) => {
                const node = view.nodes.find((node) => node.id === event.target.value);
                if (node) onSelect(node);
              }}
            >
              <option value="">Choose a node</option>
              {view.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.kind} · {symbolName(node)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Visible connection
            <select
              value={edge?.id ?? ''}
              onChange={(event) => {
                const edge = view.edges.find((edge) => edge.id === event.target.value);
                if (edge) onSelect(edge);
              }}
            >
              <option value="">Choose a connection</option>
              {view.edges.map((edge) => (
                <option key={edge.id} value={edge.id}>
                  {nodeName(view.nodes, edge.source)} → {nodeName(view.nodes, edge.target)} ·{' '}
                  {edge.label || edge.kind}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
      {selected && (
        <>
          <small>{selected.kind}</small>
          <h3>{node ? symbolName(node) : edge?.label}</h3>
        </>
      )}
      {node?.details && (
        <p className="operation-explanation">
          {node.details.explanation ||
            'No operation explanation is available. Inspect the source evidence.'}
        </p>
      )}
      {node?.details?.limitation && (
        <p className="notice operation-limitation">{node.details.limitation}</p>
      )}
      {call && call.dispatch !== 'direct' && (
        <p className="notice operation-limitation">
          {call.dispatch === 'interface' ? 'Interface contract' : 'Dynamic callable'} established.
          The implementation is unresolved; entering a compatible implementation would guess the
          target.
        </p>
      )}
      <SourcePanel
        evidence={evidence}
        selectedSource={source}
        onSelectedSource={() => {
          if (source) onSource(source);
        }}
        excerpt={excerpt}
        loading={sourceLoading}
        error={sourceError}
        onRetry={onRetrySource}
        onRefresh={onRefreshSource}
      />
      {selected && !localSource && sourceContent}
      {binding && (
        <section className="binding-investigation" aria-label="Pinned binding investigation">
          <h3>Inspecting binding: {binding.name}</h3>
          <button onClick={onDismissBinding}>Dismiss binding investigation</button>
          <p className="muted">
            Known sites from revealed regions. Declaration identity separates shadowed variables;
            hidden regions and aliases may contain other uses.
          </p>
          {localSites.map(({ node, access }, index) => (
            <button
              className="match"
              key={`${node.id}:${index}`}
              onClick={() => {
                onOccurrence(node, access.source);
              }}
            >
              {access.kind} · {access.expression} · line {access.source.line}
              {!view?.nodes.some((visible) => visible.id === node.id) && ' · reveal occurrence'}
            </button>
          ))}
          {!localSites.length && (
            <p>
              No occurrences in this view. Return to the binding's function or reveal more regions.
            </p>
          )}
        </section>
      )}

      {selected && (
        <>
          {node ? (
            <>
              <code>{node.details?.expression || node.signature}</code>
              <p className="source-location">{node.packageId}</p>
              {!node.details && !node.documentation && (
                <p>No documented purpose supplied. Design intent is unknown.</p>
              )}
              <div className="actions">
                {!node.parentId && (
                  <>
                    <button disabled={busy} onClick={() => onFocus(node.id, node.kind)}>
                      Focus symbol
                    </button>
                    <button
                      disabled={busy || !!impact}
                      onClick={() =>
                        onChange({
                          expanded: request?.expanded.includes(node.id)
                            ? request.expanded.filter((id) => id !== node.id)
                            : [...(request?.expanded ?? []).slice(-19), node.id],
                        })
                      }
                    >
                      {request?.expanded.includes(node.id)
                        ? 'Collapse neighbors'
                        : 'Expand neighbors'}
                    </button>
                  </>
                )}
                {!node.parentId && ['function', 'method'].includes(node.kind) && (
                  <>
                    <button
                      disabled={busy || !!impact}
                      onClick={() =>
                        onChange({
                          internals: request?.internals.includes(node.id)
                            ? request.internals.filter((id) => id !== node.id)
                            : [...(request?.internals ?? []).slice(-15), node.id],
                        })
                      }
                    >
                      {request?.internals.includes(node.id) ? 'Collapse behavior' : 'Open behavior'}
                    </button>
                    <button disabled={busy || !!impact} onClick={() => onFollow(node.id)}>
                      Flow overview
                    </button>
                  </>
                )}
                {canEnterCall(node) && (
                  <button
                    disabled={busy || callDepth >= MAX_CALL_DEPTH}
                    onClick={() => onEnter(node)}
                  >
                    Enter this call
                  </button>
                )}
                {node.details?.region && (
                  <button disabled={busy} onClick={() => onReveal(node)}>
                    Reveal region
                  </button>
                )}
                {node.parentId && !canEnterCall(node) && !node.details?.region && (
                  <button disabled={busy || !!impact} onClick={() => onFollow(node.parentId!)}>
                    View function flow
                  </button>
                )}
                <button onClick={() => onShow(node)}>Show selected node</button>
              </div>
              {node.documentation && (
                <details>
                  <summary>Documentation</summary>
                  <p>{node.documentation}</p>
                </details>
              )}
              {node.parentId && (
                <p className="muted">
                  Within {nodeName(view?.nodes, node.parentId, node.qualifiedName)}. Static source
                  structure; path feasibility is unknown.
                </p>
              )}
              {call && (
                <details className="call-boundary">
                  <summary>Arguments and returned positions</summary>
                  <small>Type-resolved callable signature</small>
                  <code>{call.signature}</code>
                  {call.receiver && (
                    <p>
                      Receiver: <code>{call.receiver}</code>
                    </p>
                  )}
                  {call.arguments.map((argument, index) => (
                    <p key={index}>
                      <code>
                        {argument.expression}
                        {argument.spread ? '...' : ''}
                      </code>{' '}
                      supplies {argument.parameter} at position {argument.position}
                      {argument.variadic ? ' (variadic)' : ''}. <small>{argument.type}</small>
                    </p>
                  ))}
                  {call.results.map((result) => (
                    <p key={result.position}>
                      Returned position {result.position} →{' '}
                      <code>
                        {result.destination === '_' ? 'discarded (_)' : result.destination}
                      </code>
                      <small>{result.type}</small>
                    </p>
                  ))}
                  {!call.results.length && <p>This callable has no returned positions.</p>}
                  <p className="muted">
                    These are source mappings. Passing an argument does not prove its influence on a
                    returned value. Aliasing and interprocedural value dependence are not tracked.
                  </p>
                </details>
              )}
              {!!node.details?.accesses?.length && (
                <details>
                  <summary>Reads, writes, and definitions</summary>
                  {node.details.accesses.map((access, index) => (
                    <div className="access" key={index}>
                      <code>{access.expression}</code>
                      <span>
                        {access.kind.replace('_', ' and ')}
                        {access.mutation ? ` · ${access.mutation}` : ''}
                      </span>
                      <button
                        onClick={() =>
                          access.symbolId ? onUsage(access.symbolId) : onBinding(access)
                        }
                      >
                        {access.symbolId
                          ? 'Inspect known readers and writers'
                          : 'Inspect this local binding'}
                      </button>
                    </div>
                  ))}
                </details>
              )}
              {!node.parentId && summary && (
                <section aria-label="Hidden relationships">
                  <h3>Connections and omissions</h3>
                  <p>
                    {summary.incoming} incoming source sites · {summary.outgoing} outgoing source
                    sites · {summary.distinctSymbols ?? '?'} distinct symbols.
                  </p>
                  <p>
                    {summary.filtered ?? 0} hidden by filters · {summary.collapsed ?? 0} collapsed ·{' '}
                    {summary.paginated ?? 0} outside this neighbor page · {summary.limited ?? 0}{' '}
                    outside the view budget.
                  </p>
                  {!!summary.groups?.length && (
                    <details>
                      <summary>Reveal by package and relationship</summary>
                      {summary.groups.map((group, index) => (
                        <div className="neighbor-group" key={index}>
                          <small>
                            {group.packageId} · {group.direction} {group.kind}
                          </small>
                          <p>
                            {group.symbols} distinct symbols · {group.sites} source sites ·{' '}
                            {group.visible} visible sites{group.filtered ? ' · filtered' : ''}
                          </p>
                          <button
                            disabled={busy || !!impact}
                            onClick={() =>
                              onGroup(node.id, {
                                packageId: group.packageId,
                                kind: group.kind,
                                direction: group.direction,
                              })
                            }
                          >
                            Show only {group.direction} {group.kind.replace('_', ' ')}{' '}
                            {group.direction === 'incoming' ? 'from' : 'to'} {group.packageId} for{' '}
                            {symbolName(node)}
                          </button>
                        </div>
                      ))}
                      {!!summary.moreGroups && (
                        <p>
                          {summary.moreGroups} additional groups. Browse their packages or change
                          the relationship filters.
                        </p>
                      )}
                      {request?.groups?.[node.id] && (
                        <button disabled={busy || !!impact} onClick={() => onClearGroup(node.id)}>
                          Show all packages
                        </button>
                      )}
                    </details>
                  )}
                  {summary.pageOffset !== undefined && (
                    <>
                      <p>
                        Up to {summary.pageSize} distinct endpoint/kind connections per page.
                        Repeated sites share a connection.
                      </p>
                      <div className="actions">
                        <button
                          disabled={busy || !!impact || summary.pageOffset === 0}
                          onClick={() => onPage('previous')}
                        >
                          Previous neighbors
                        </button>
                        <button
                          disabled={busy || !!impact || !summary.hasMore}
                          onClick={() => onPage('next')}
                        >
                          Next neighbors
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {!node.parentId && (
                <details>
                  <summary>Investigate a hypothetical change</summary>
                  <label>
                    Change category
                    <select
                      value={impact}
                      onChange={(event) => onImpact(node.id, event.target.value)}
                    >
                      <option value="">Normal exploration</option>
                      <option value="signature">Signature</option>
                      <option value="field">Field</option>
                      <option value="behavior">Behavior / result</option>
                    </select>
                  </label>
                </details>
              )}
            </>
          ) : (
            edge && (
              <>
                <p>
                  {nodeName(view?.nodes, edge.source, 'Caller')} →{' '}
                  {nodeName(view?.nodes, edge.target, 'Target')}
                </p>
                <code>{view?.nodes.find((node) => node.id === edge.target)?.signature}</code>
                <p>
                  {edge.certainty === 'possible'
                    ? 'Possible source relationship. The concrete call target or runtime execution is unresolved.'
                    : edge.kind === 'control'
                      ? 'Static control structure, not observed execution.'
                      : 'Resolved source relationship. It may execute conditionally.'}
                </p>
                <code>{edge.expression}</code>
                {edge.siteCount && edge.siteCount > 1 && (
                  <>
                    <h3>{edge.siteCount} source occurrences</h3>
                    {sites.map((site) => (
                      <button
                        className="match"
                        key={site.id}
                        disabled={sitesBusy}
                        onClick={() => onSource(site.evidence)}
                      >
                        <code>{site.expression}</code>
                        <small>{formatSource(site.evidence)}</small>
                      </button>
                    ))}
                    <div className="actions">
                      <button
                        disabled={sitesBusy || siteOffset === 0}
                        onClick={() => setSiteOffset(Math.max(0, siteOffset - 40))}
                      >
                        Previous sites
                      </button>
                      <button
                        disabled={sitesBusy || siteOffset + sites.length >= edge.siteCount}
                        onClick={() => setSiteOffset(siteOffset + 40)}
                      >
                        More sites
                      </button>
                    </div>
                    {sitesBusy && <p role="status">Loading source sites…</p>}
                    {siteError && <p role="alert">{siteError}</p>}
                  </>
                )}
              </>
            )
          )}
        </>
      )}
      {!selected && (
        <p className="muted">
          Hover or focus a node or edge for source identity. Click or press Enter to pin details.
          Escape closes the inspector and preserves your selection.
        </p>
      )}
    </>
  );
}
