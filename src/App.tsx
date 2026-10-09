import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import { backend, isDesktop } from './backend';
import { flushSync } from 'react-dom';
import { measurePresentation } from './presentation';
import type { PresentationMode } from './benchmark';
import { displayBounds } from './layout/bounds';
import { useNativeBenchmark } from './useNativeBenchmark';
import type {
  GraphRequest,
  GraphView,
  ProjectSummary,
  SourceExcerpt,
  SourceSpan,
  SymbolFact,
  ViewNode,
  ViewEdge,
} from './shared/protocol';
import {
  LatestRequest,
  RELATIONS,
  requestFor,
  toggleId,
  validateView,
  VIEW_LIMIT,
  neighborPage,
} from './exploration';
import { LayoutClient } from './layout/client';
import type { LayoutResult } from './layout/contract';

type SymbolNode = Node<{
  label: string;
  kind: string;
  summary: string;
  grouped: boolean;
  focused: boolean;
}>;

function SymbolCard({ data }: NodeProps<SymbolNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div
        className={`symbol-card ${data.grouped ? 'grouped' : ''} ${data.focused ? 'focused' : ''}`}
      >
        <small>
          {data.kind}
          {data.grouped ? ' · static behavior' : ''}
        </small>
        <strong>{data.label}</strong>
        <span>{data.summary}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}

const nodeTypes = { symbol: SymbolCard };

declare global {
  interface Window {
    __SONAR_METRICS__: {
      ready: boolean;
      mode: string;
      nodes: number;
      edges: number;
      payloadBytes: number;
      expansionMs: number;
      snapshot: string;
      requests: number;
    };
  }
}
window.__SONAR_METRICS__ = {
  ready: false,
  mode: isDesktop ? 'desktop' : 'sample',
  nodes: 0,
  edges: 0,
  payloadBytes: 0,
  expansionMs: 0,
  snapshot: '',
  requests: 0,
};

const formatSource = (span: SourceSpan) => `${span.file}:${span.line}:${span.column}`;

export default function App() {
  const [root, setRoot] = useState('');
  const [project, setProject] = useState<ProjectSummary>();

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SymbolFact[]>([]);

  const [request, setRequest] = useState<GraphRequest>();
  const [history, setHistory] = useState<GraphRequest[]>([]);

  const [view, setView] = useState<GraphView>();
  const [nodes, setNodes] = useState<SymbolNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [selected, setSelected] = useState<ViewNode | ViewEdge>();
  const [excerpt, setExcerpt] = useState<SourceExcerpt>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [impact, setImpact] = useState('');

  const layout = useRef<LayoutClient | null>(null);
  const latest = useRef(new LatestRequest());
  const searchLatest = useRef(new LatestRequest());
  const sourceLatest = useRef(new LatestRequest());
  const projectLatest = useRef(new LatestRequest());
  const benchmarking = useRef(false);

  const positions = useRef(
    new Map<string, { x: number; y: number; width: number; height: number; parentId?: string }>(),
  );
  const flow = useRef<ReactFlowInstance<SymbolNode> | null>(null);

  useEffect(() => {
    layout.current = new LayoutClient();
    window.__SONAR_METRICS__.ready = true;

    return () => {
      latest.current.invalidate();
      layout.current?.dispose();
      window.__SONAR_METRICS__.ready = false;
    };
  }, []);

  useEffect(() => {
    const current = searchLatest.current.next();

    if (!project || benchmarking.current) {
      setMatches([]);
      return;
    }

    const timer = setTimeout(
      () =>
        backend
          .search(query)
          .then((results) => {
            if (current()) setMatches(results);
          })
          .catch((err) => {
            if (current()) setError(String(err));
          }),
      180,
    );

    return () => clearTimeout(timer);
  }, [query, project]);

  const navigate = (next: GraphRequest, record = true) => {
    if (record && request) setHistory((previous) => [...previous.slice(-19), request]);

    setImpact('');
    setRequest(next);
  };

  const loadProject = async (refresh = false) => {
    const current = projectLatest.current.next();
    latest.current.invalidate();
    searchLatest.current.invalidate();
    sourceLatest.current.invalidate();

    setBusy(true);
    setError('');
    setExcerpt(undefined);
    setSelected(undefined);

    // Old facts are removed while a replacement snapshot is being analyzed.
    setView(undefined);
    setNodes([]);
    setEdges([]);

    try {
      const summary = await (refresh ? backend.refresh() : backend.open(root));
      if (!current()) return;

      setProject(summary);
      if (refresh && request) setRequest({ ...request });
      else {
        positions.current.clear();
        setHistory([]);
        setRequest(undefined);
      }
    } catch (err) {
      if (current()) {
        setProject(undefined);
        setRequest(undefined);
        setError(String(err));
      }
    } finally {
      if (current()) setBusy(false);
    }
  };

  const paintView = useCallback(
    async (
      result: GraphView,
      current: () => boolean,
      started: number,
      mode: PresentationMode = 'frames',
    ) => {
      validateView(result, VIEW_LIMIT);

      const grouped = new Set(
        result.nodes.filter((node) => node.parentId).map((node) => node.parentId),
      );

      const layoutStarted = performance.now();
      const geometry: LayoutResult = await layout.current!.layout({
        nodes: result.nodes.map((node) => {
          const old = positions.current.get(node.id);
          const sameGroup = old?.parentId === node.parentId;

          return {
            id: node.id,
            parentId: node.parentId,
            width: grouped.has(node.id) ? 650 : 220,
            height: grouped.has(node.id) ? 450 : 88,
            position: sameGroup && old ? { x: old.x, y: old.y } : undefined,
          };
        }),
        edges: result.edges.map(({ id, source, target }) => ({ id, source, target })),
      });
      const layoutMs = performance.now() - layoutStarted;
      if (!current()) return;

      const ordered = [
        ...result.nodes.filter((node) => !node.parentId),
        ...result.nodes.filter((node) => node.parentId),
      ];

      const commitStarted = performance.now();
      flushSync(() => {
        setNodes(
          ordered.map((node) => {
            const size = geometry.sizes[node.id];
            const position = geometry.positions[node.id];
            positions.current.set(node.id, { ...position, ...size, parentId: node.parentId });
            const summary = result.summaries.find((item) => item.nodeId === node.id);
            const summaryText = summary
              ? `${summary.incoming} in · ${summary.outgoing} out${summary.hidden ? ` · ${summary.hidden} hidden` : ''}`
              : '';

            return {
              id: node.id,
              type: 'symbol',
              parentId: node.parentId,
              extent: node.parentId ? ('parent' as const) : undefined,
              position,
              width: size.width,
              height: size.height,
              style: size,
              data: {
                label: node.name,
                kind: node.kind,
                grouped: grouped.has(node.id),
                focused: node.id === result.focus,
                summary: summaryText,
              },
            };
          }),
        );

        setEdges(
          result.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.label || edge.kind,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: {
              stroke:
                edge.kind === 'data' ? '#9e61cf' : edge.kind === 'control' ? '#277e88' : '#52647d',
              strokeDasharray: edge.certainty === 'possible' ? '6 4' : undefined,
            },
            labelStyle: { fontSize: 11 },
            reconnectable: false,
          })),
        );

        setView(result);
        setSelected((previous) =>
          previous
            ? (result.nodes.find((node) => node.id === previous.id) ??
              result.edges.find((edge) => edge.id === previous.id))
            : undefined,
        );
        setExcerpt(undefined);
      });
      const commitMs = performance.now() - commitStarted;

      // Position memory is bounded independently of the source index.
      while (positions.current.size > 400)
        positions.current.delete(positions.current.keys().next().value!);

      Object.assign(window.__SONAR_METRICS__, {
        nodes: result.nodes.length,
        edges: result.edges.length,
        payloadBytes: new TextEncoder().encode(JSON.stringify(result)).length,
        expansionMs: performance.now() - started,
        snapshot: result.snapshot,
      });

      const presentation = await measurePresentation(
        current,
        async () => {
          if (!flow.current) throw new Error('Graph viewport is not ready');

          const bounds = displayBounds(
            ordered.map((node) => ({
              parentId: node.parentId,
              position: geometry.positions[node.id],
              ...geometry.sizes[node.id],
            })),
          );

          if (bounds) await flow.current.fitBounds(bounds, { padding: 0.2, duration: 0 });
        },
        undefined,
        undefined,
        mode,
      );
      window.__SONAR_METRICS__.expansionMs = performance.now() - started;

      return {
        presentation: mode,
        includesFramePresentation: mode === 'frames',
        layoutMs,
        commitMs,
        ...presentation,
        expansionMs: window.__SONAR_METRICS__.expansionMs,
        nodes: result.nodes.length,
        edges: result.edges.length,
        payloadBytes: window.__SONAR_METRICS__.payloadBytes,
        snapshot: result.snapshot,
      };
    },
    [],
  );

  useEffect(() => {
    if (!request || !project || benchmarking.current) return;

    const current = latest.current.next();
    const started = performance.now();
    setBusy(true);
    setError('');
    window.__SONAR_METRICS__.requests++;

    (impact ? backend.impact(request.focus, impact) : backend.graph(request))
      .then((result) => {
        if (!current()) return;
        if (result.snapshot !== project.snapshot)
          throw new Error(
            'Analysis snapshot changed. Refresh the project to retrieve a consistent view.',
          );

        return paintView(result, current, started);
      })
      .catch((err) => {
        if (current()) setError(String(err));
      })
      .finally(() => {
        if (current()) setBusy(false);
      });

    return () => latest.current.invalidate();
  }, [request, project, impact, paintView]);

  useNativeBenchmark({
    active: benchmarking,
    begin: (config) => {
      setBusy(true);
      setRoot(config.root);
      setQuery(config.query);
    },
    opened: (summary) => {
      positions.current.clear();
      setProject(summary);
    },
    render: (result, valid, started, presentation) => {
      setRequest(requestFor(result.focus));
      window.__SONAR_METRICS__.requests++;
      return paintView(result, valid, started, presentation);
    },
    finish: () => setBusy(false),
    failed: (error) => {
      setBusy(false);
      setError(String(error));
    },
  });

  const selectedNode = selected && 'name' in selected ? selected : undefined;
  const selectedSummary = selectedNode
    ? view?.summaries.find((summary) => summary.nodeId === selectedNode.id)
    : undefined;

  const inspect = async () => {
    if (!selected) return;

    const current = sourceLatest.current.next();
    setExcerpt(undefined);

    try {
      const result = await backend.source(
        'evidence' in selected ? selected.evidence : selected.source,
      );
      if (current()) setExcerpt(result);
    } catch (err) {
      if (current()) setError(String(err));
    }
  };

  const select = (value: ViewNode | ViewEdge) => {
    sourceLatest.current.invalidate();
    setSelected(value);
    setExcerpt(undefined);
  };

  const change = (updates: Partial<GraphRequest>) => {
    if (request)
      navigate({
        ...request,
        ...updates,
        ...(updates.kinds || updates.direction ? { offsets: {} } : {}),
      });
  };

  const onNodesChange = (changes: NodeChange<SymbolNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));

    for (const change of changes)
      if (change.type === 'position' && change.position) {
        const old = positions.current.get(change.id);
        if (old) positions.current.set(change.id, { ...old, ...change.position });
      }
  };

  const statusLabel = busy
    ? 'Analyzing / laying out…'
    : view
      ? `${view.nodes.length} nodes · ${view.edges.length} edges${view.truncated ? ' · view limit reached' : ''}`
      : 'Choose a project, then a symbol';

  return (
    <div className="app">
      <header>
        <div>
          <strong>Go Sonar</strong>
          <span>Local Go code explorer</span>
        </div>
        {!isDesktop && <b className="sample-banner">SAMPLE PREVIEW · no local analysis</b>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void loadProject();
          }}
        >
          <input
            aria-label="Project path"
            placeholder="Absolute Go module path"
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            disabled={!isDesktop}
          />
          <button disabled={busy || (isDesktop && !root.trim())}>
            {isDesktop ? 'Open project' : 'Open sample'}
          </button>
        </form>
        <button disabled={!project || busy} onClick={() => void loadProject(true)}>
          Refresh
        </button>
      </header>
      <div className="workspace">
        <aside className="explorer">
          <h2>{project?.name ?? 'Start an exploration'}</h2>
          {project && (
            <>
              <p className="muted">
                {project.symbolCount} symbols · {project.relationCount} relations
              </p>
              <p className="muted">
                Snapshot {project.snapshot.slice(0, 12)}
                <br />
                {project.stats.analyzedPackages} packages analyzed · {project.stats.reusedPackages}{' '}
                reused · {project.stats.changedFiles} files changed ·{' '}
                {Math.round(project.stats.durationMs)} ms
              </p>
            </>
          )}
          <label>
            Find any symbol
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, struct, field, method…"
              disabled={!project}
            />
          </label>
          <div className="matches">
            {matches.map((symbol) => (
              <button
                className="match"
                key={symbol.id}
                onClick={() => navigate(requestFor(symbol.id))}
              >
                <strong>{symbol.name}</strong>
                <small>
                  {symbol.kind} · {symbol.packageId}
                </small>
              </button>
            ))}
          </div>
          {project && !matches.length && (
            <p className="muted">No matching symbols in the covered analysis.</p>
          )}
          <h3>Relationships</h3>
          {RELATIONS.map((kind) => (
            <label className="checkbox" key={kind}>
              <input
                type="checkbox"
                checked={request?.kinds.includes(kind) ?? true}
                disabled={!request}
                onChange={() => change({ kinds: toggleId(request!.kinds, kind) })}
              />
              {kind.replace('_', ' ')}
            </label>
          ))}
          <label>
            Neighbor direction
            <select
              disabled={!request}
              value={request?.direction ?? 'both'}
              onChange={(event) =>
                change({ direction: event.target.value as GraphRequest['direction'] })
              }
            >
              <option value="both">Incoming and outgoing</option>
              <option value="incoming">Incoming consumers</option>
              <option value="outgoing">Outgoing dependencies</option>
            </select>
          </label>
          <p className="muted">
            At most {VIEW_LIMIT} nodes per view. Filters and collapsed branches hide relationships.
          </p>
        </aside>
        <main>
          <div className="graph-toolbar">
            <button
              disabled={!history.length || busy}
              onClick={() => {
                const previous = history[history.length - 1];
                setHistory(history.slice(0, -1));
                navigate(previous, false);
              }}
            >
              Back
            </button>
            <button
              disabled={!view}
              onClick={() => {
                const bounds = displayBounds(
                  nodes.map((node) => ({
                    parentId: node.parentId,
                    position: node.position,
                    width: node.width ?? 220,
                    height: node.height ?? 88,
                  })),
                );

                if (bounds) void flow.current?.fitBounds(bounds, { padding: 0.2 });
              }}
            >
              Fit graph
            </button>
            <button
              disabled={!request}
              onClick={() => change({ expanded: [], internals: [], offsets: {} })}
            >
              Collapse branches
            </button>
            <span role="status">{statusLabel}</span>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {impact && (
            <div className="notice">
              Hypothetical {impact} change: candidates for inspection, not proven breakage. Dynamic
              behavior and incomplete coverage may hide effects.
            </div>
          )}
          <div className="canvas">
            <ReactFlow<SymbolNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onInit={(instance) => {
                flow.current = instance;
              }}
              onNodesChange={onNodesChange}
              onNodeClick={(_, node) => {
                const fact = view?.nodes.find((value) => value.id === node.id);

                if (fact) select(fact);
              }}
              onEdgeClick={(_, edge) => {
                const fact = view?.edges.find((value) => value.id === edge.id);

                if (fact) select(fact);
              }}
              onNodeDoubleClick={(_, node) => {
                const fact = view?.nodes.find((value) => value.id === node.id);

                if (fact) navigate(requestFor(fact.relatedSymbolId ?? fact.parentId ?? fact.id));
              }}
              nodesConnectable={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              onlyRenderVisibleElements
              minZoom={0.08}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
            {!view && !busy && (
              <div className="empty">
                Explore calls, data relationships, and static function behavior.
                <br />
                {!isDesktop
                  ? 'Open the labelled sample to preview the workspace.'
                  : 'Open a local Go module to analyze its source.'}
              </div>
            )}
          </div>
          {project?.diagnostics.length ? (
            <details className="diagnostics" open>
              <summary>Analysis coverage: {project.diagnostics.length} diagnostic(s)</summary>
              {project.diagnostics.map((diagnostic, index) => (
                <p key={index}>
                  {diagnostic.severity}: {diagnostic.message}{' '}
                  {diagnostic.packageId && `(${diagnostic.packageId})`}
                </p>
              ))}
            </details>
          ) : project ? (
            <p className="coverage">
              No analyzer diagnostics. Static evidence does not establish runtime execution or full
              dynamic target coverage.
            </p>
          ) : null}
        </main>
        <aside className="inspector">
          <h2>Context & evidence</h2>
          {selected ? (
            <>
              <small>{'kind' in selected ? selected.kind : ''}</small>
              <h3>{selectedNode?.name ?? ('label' in selected ? selected.label : '')}</h3>
              {selectedNode ? (
                <>
                  <code>{selectedNode.signature}</code>
                  <p>
                    {selectedNode.documentation ||
                      'No documented purpose supplied. Design intent is unknown.'}
                  </p>
                  {selectedNode.parentId && (
                    <p>
                      Static source structure within a function. No execution or path feasibility is
                      implied.
                    </p>
                  )}
                  <div className="actions">
                    <button
                      onClick={() =>
                        navigate(
                          requestFor(
                            selectedNode.relatedSymbolId ??
                              selectedNode.parentId ??
                              selectedNode.id,
                          ),
                        )
                      }
                    >
                      Focus symbol
                    </button>
                    {!selectedNode.parentId && (
                      <button
                        disabled={!!impact}
                        onClick={() =>
                          change({ expanded: toggleId(request!.expanded, selectedNode.id) })
                        }
                      >
                        {request?.expanded.includes(selectedNode.id)
                          ? 'Collapse neighbors'
                          : 'Expand neighbors'}
                      </button>
                    )}
                    {['function', 'method'].includes(selectedNode.kind) &&
                      !selectedNode.parentId && (
                        <button
                          disabled={!!impact}
                          onClick={() =>
                            change({ internals: toggleId(request!.internals, selectedNode.id) })
                          }
                        >
                          {request?.internals.includes(selectedNode.id)
                            ? 'Collapse behavior'
                            : 'Open behavior'}
                        </button>
                      )}
                  </div>
                  {!selectedNode.parentId && selectedSummary?.pageOffset !== undefined && (
                    <div className="neighbor-page">
                      <p>
                        Neighbor page starts at relation site {selectedSummary.pageOffset + 1}. Up
                        to {selectedSummary.pageSize} source relation sites (edges) per page, not
                        distinct symbols.
                      </p>
                      <div className="actions">
                        <button
                          disabled={busy || !!impact || selectedSummary.pageOffset === 0}
                          onClick={() => {
                            if (request)
                              navigate(
                                neighborPage(request, selectedNode.id, selectedSummary, 'previous'),
                              );
                          }}
                        >
                          Previous neighbors
                        </button>
                        <button
                          disabled={busy || !!impact || !selectedSummary.hasMore}
                          onClick={() => {
                            if (request)
                              navigate(
                                neighborPage(request, selectedNode.id, selectedSummary, 'next'),
                              );
                          }}
                        >
                          Next neighbors
                        </button>
                      </div>
                    </div>
                  )}
                  {!selectedNode.parentId && (
                    <label>
                      Hypothetical change
                      <select
                        value={impact}
                        onChange={(event) => {
                          setRequest((previous) =>
                            previous ? { ...previous, focus: selectedNode.id } : previous,
                          );
                          setImpact(event.target.value);
                        }}
                      >
                        <option value="">Normal exploration</option>
                        <option value="signature">Signature</option>
                        <option value="field">Field</option>
                        <option value="behavior">Behavior / result</option>
                      </select>
                    </label>
                  )}
                </>
              ) : (
                'certainty' in selected && (
                  <>
                    <p>
                      {selected.certainty === 'possible'
                        ? 'Possible relationship. Source evidence identifies a candidate, not an observed call target.'
                        : selected.kind === 'control'
                          ? 'Control flow from static source structure, not observed execution.'
                          : selected.kind === 'data'
                            ? 'Data dependence derived from source, distinct from execution order.'
                            : 'Resolved source relationship. This does not mean it executes for every input.'}
                    </p>
                    <p>
                      {selected.source} → {selected.target}
                    </p>
                  </>
                )
              )}
              <p className="source-location">
                {formatSource('evidence' in selected ? selected.evidence : selected.source)}
              </p>
              <button onClick={() => void inspect()}>Open source evidence</button>
              {excerpt && (
                <div className="source">
                  <small>
                    {excerpt.file} · from line {excerpt.firstLine}
                  </small>
                  <pre>
                    {excerpt.text
                      .split('\n')
                      .map(
                        (line, index) =>
                          `${String(excerpt.firstLine + index).padStart(4)}  ${line}`,
                      )
                      .join('\n')}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <p className="muted">
              Select a node or labelled edge to understand its evidence. Double-click a node to
              refocus. Drag nodes to preserve a working arrangement.
            </p>
          )}
          <hr />
          <p className="legend">
            Arrows show relation direction. Teal: control flow. Purple: data flow. Dashed: possible
            relation. Source connections cannot be edited.
          </p>
        </aside>
      </div>
    </div>
  );
}
