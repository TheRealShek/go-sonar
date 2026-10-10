import { useEffect, useState } from 'react';
import { backend } from './backend';
import { formatSource } from './GraphCards';
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
}) {
  const [sites, setSites] = useState<RelationSite[]>([]);
  const [siteOffset, setSiteOffset] = useState(0);
  const [siteError, setSiteError] = useState('');
  const [sitesBusy, setSitesBusy] = useState(false);
  const [binding, setBinding] = useState<Access>();
  const edge = selected && 'evidence' in selected ? selected : undefined;
  const node = selected && 'name' in selected ? selected : undefined;
  useEffect(() => {
    setSiteOffset(0);
    setBinding(undefined);
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
  const localSites = binding
    ? (view?.nodes.flatMap((candidate) =>
        (candidate.details?.accesses ?? [])
          .filter((access) => access.id === binding.id)
          .map((access) => ({ node: candidate, access })),
      ) ?? [])
    : [];
  return (
    <>
      <h2>Evidence</h2>
      {selected && (
        <>
          <small>{selected.kind}</small>
          <h3>{node?.name ?? edge?.label}</h3>
          {node ? (
            <>
              <code>{node.signature || node.details?.expression}</code>
              <p className="source-location">{node.packageId}</p>
              {(node.details?.explanation || node.documentation) && (
                <details>
                  <summary>{node.details ? 'Operation' : 'Documentation'}</summary>
                  <p>{node.details?.explanation ?? node.documentation}</p>
                </details>
              )}
              {node.parentId && (
                <p className="muted">
                  Within{' '}
                  {view?.nodes.find((parent) => parent.id === node.parentId)?.name ??
                    node.qualifiedName}
                  .
                </p>
              )}
              {node.details?.limitation && <p className="notice">{node.details.limitation}</p>}
              <div className="actions">
                <button onClick={() => onShow(node)}>Show selected node</button>
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
                      Follow flow
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
              </div>
              {call && (
                <details className="call-boundary">
                  <summary>Arguments and results</summary>
                  <small>Type-resolved callable signature</small>
                  <code>{call.signature}</code>
                  {call.receiver && (
                    <p>
                      Receiver: <code>{call.receiver}</code>
                    </p>
                  )}
                  {call.dispatch !== 'direct' && (
                    <p className="notice">
                      {call.dispatch === 'interface' ? 'Interface contract' : 'Dynamic callable'}{' '}
                      established. The implementation is unresolved; entering a compatible
                      implementation would guess the target.
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
                  <summary>Reads and writes</summary>
                  {node.details.accesses.map((access, index) => (
                    <div className="access" key={index}>
                      <code>{access.expression}</code>
                      <span>
                        {access.kind.replace('_', ' and ')}
                        {access.mutation ? ` · ${access.mutation}` : ''}
                      </span>
                      <button
                        onClick={() =>
                          access.symbolId ? onUsage(access.symbolId) : setBinding(access)
                        }
                      >
                        {access.symbolId
                          ? 'Inspect known readers and writers'
                          : 'Inspect this local binding'}
                      </button>
                    </div>
                  ))}
                  {binding && (
                    <>
                      <p>
                        Binding {binding.name}. Declaration identity keeps shadowed variables
                        separate. These are sites in the visible region; hidden regions and aliases
                        may contain other uses.
                      </p>
                      {localSites.map(({ node, access }, index) => (
                        <button className="match" key={index} onClick={() => onSelect(node)}>
                          {access.kind} · {access.expression} · line {access.source.line}
                        </button>
                      ))}
                    </>
                  )}
                </details>
              )}
              {!node.parentId && summary && (
                <details>
                  <summary>Connections · {summary.hidden} hidden</summary>
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
                              onChange({
                                expanded:
                                  node.id === request?.focus || request?.expanded.includes(node.id)
                                    ? request?.expanded
                                    : [...(request?.expanded ?? []).slice(-19), node.id],
                                kinds: request?.kinds.includes(group.kind)
                                  ? request.kinds
                                  : [...(request?.kinds ?? []), group.kind],
                                direction: group.direction as GraphRequest['direction'],
                                groups: {
                                  ...request?.groups,
                                  [node.id]: {
                                    packageId: group.packageId,
                                    kind: group.kind,
                                    direction: group.direction,
                                  },
                                },
                                offsets: { ...request?.offsets, [node.id]: 0 },
                              })
                            }
                          >
                            Reveal this group
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
                        <button
                          onClick={() =>
                            onChange({
                              groups: Object.fromEntries(
                                Object.entries(request.groups ?? {}).filter(
                                  ([id]) => id !== node.id,
                                ),
                              ),
                              offsets: { ...request.offsets, [node.id]: 0 },
                            })
                          }
                        >
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
                </details>
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
                  {view?.nodes.find((node) => node.id === edge.source)?.name ?? 'Caller'} →{' '}
                  {view?.nodes.find((node) => node.id === edge.target)?.name ?? 'Target'}
                </p>
                <code>{view?.nodes.find((node) => node.id === edge.target)?.signature}</code>
                <p
                  className="muted"
                  title="Source relationships do not establish observed execution."
                >
                  {edge.certainty === 'possible'
                    ? 'Possible relationship'
                    : edge.kind === 'control'
                      ? 'Static control'
                      : 'Resolved source relationship'}
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
          {source && <p className="source-location">{formatSource(source)}</p>}
          {source && localSource ? (
            <button onClick={() => onSource(source)}>Open source evidence</button>
          ) : (
            <>
              <p className="notice">External source. Inspect a local call site.</p>
              {callers?.map((edge) => (
                <button className="match" key={edge.id} onClick={() => onSelect(edge)}>
                  Local call from {view?.nodes.find((node) => node.id === edge.source)?.name} · line{' '}
                  {edge.evidence.line}
                </button>
              ))}
            </>
          )}
          {excerpt && (
            <div className="source">
              <small>
                {excerpt.file} · from line {excerpt.firstLine}
              </small>
              <pre>
                {excerpt.text.split('\n').map((line, index) => (
                  <span
                    className={
                      evidence &&
                      excerpt.firstLine + index >= evidence.line &&
                      excerpt.firstLine + index <= evidence.endLine
                        ? 'source-highlight'
                        : ''
                    }
                    key={index}
                  >
                    {String(excerpt.firstLine + index).padStart(4)} {line}
                  </span>
                ))}
              </pre>
            </div>
          )}
        </>
      )}
      {!selected && <p className="muted">Select a node or connection.</p>}
      {!!view?.nodes.length && (
        <details className="keyboard-browser">
          <summary>Keyboard inspection</summary>
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
                  {node.kind} · {node.name}
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
                  {view.nodes.find((node) => node.id === edge.source)?.name} →{' '}
                  {view.nodes.find((node) => node.id === edge.target)?.name} ·{' '}
                  {edge.label || edge.kind}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
      <details className="legend">
        <summary>Graph legend</summary>
        <p>
          Arrows show relationship direction. Teal control edges show source order. Dependency
          placement has no execution order. Dashed edges mark unresolved possibilities; loop-back
          edges use a separate dashed route.
        </p>
      </details>
    </>
  );
}
