import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import { backend, isDesktop, chooseProjectFolder } from './backend';
import { nodeTypes, IdentityCard, type SymbolNode } from './GraphCards';
import { FlowNavigator } from './FlowNavigator';
import { EvidenceInspector } from './EvidenceInspector';
import {
  canEnterCall,
  boundRequest,
  refreshNavigation,
  flowAfterReveal,
  currentOperation,
  frameMatchesSnapshot,
  followEdge,
  successors,
  outcomePaths,
  revealRegion,
  focusViewport,
  MAX_CALL_DEPTH,
  type NavigationFrame,
  type CallFrame,
  type FlowTrail,
} from './navigation';
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
  Discovery,
  SymbolPage,
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

function recentPaths(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('sonar.recentPaths') ?? '[]');
    return Array.isArray(value)
      ? value
          .filter((path): path is string => typeof path === 'string' && path.length < 4096)
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [root, setRoot] = useState('');
  const [project, setProject] = useState<ProjectSummary>();

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SymbolFact[]>([]);

  const [request, setRequest] = useState<GraphRequest>();
  const [history, setHistory] = useState<NavigationFrame[]>([]);
  const [future, setFuture] = useState<NavigationFrame[]>([]);
  const [trail, setTrail] = useState<FlowTrail>();
  const [calls, setCalls] = useState<CallFrame[]>([]);
  const [outcomeId, setOutcomeId] = useState<string>();
  const [continuationCallId, setContinuationCallId] = useState<string>();
  const [hovered, setHovered] = useState<ViewNode | ViewEdge>();
  const [pinned, setPinned] = useState(false);
  const [evidence, setEvidence] = useState<SourceSpan>();
  const [discovery, setDiscovery] = useState<Discovery>();
  const [browserKind, setBrowserKind] = useState('');
  const [browserPackage, setBrowserPackage] = useState('');
  const [browserOffset, setBrowserOffset] = useState(0);
  const [browserPage, setBrowserPage] = useState<SymbolPage>();
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState(recentPaths);
  const [wideSource, setWideSource] = useState(false);

  const [view, setView] = useState<GraphView>();
  const [nodes, setNodes] = useState<SymbolNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [selected, setSelected] = useState<ViewNode | ViewEdge>();
  const [excerpt, setExcerpt] = useState<SourceExcerpt>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [impact, setImpact] = useState('');
  const [navigationNotice, setNavigationNotice] = useState('');

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
  const canvas = useRef<HTMLDivElement>(null);
  const framedFocus = useRef<string | undefined>(undefined);
  const restored = useRef<NavigationFrame | undefined>(undefined);
  const pendingSelection = useRef<string | undefined>(undefined);
  const pendingFlow = useRef<{ functionId: string; nodeId?: string } | undefined>(undefined);
  const preferences = useRef<
    Pick<GraphRequest, 'kinds' | 'direction' | 'neighborLimit'> | undefined
  >(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(
      () =>
        backend
          .search(query)
          .then((results) => {
            if (current()) {
              setMatches(results);
              setSearching(false);
            }
          })
          .catch((err) => {
            if (current()) {
              setError(String(err));
              setSearching(false);
            }
          }),
      180,
    );

    return () => clearTimeout(timer);
  }, [query, project]);

  useEffect(() => {
    let active = true;
    if (!project || benchmarking.current) {
      setDiscovery(undefined);
      return;
    }
    void backend
      .discovery()
      .then((value) => {
        if (active) setDiscovery(value);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [project]);

  useEffect(() => {
    let active = true;
    if (!project || benchmarking.current) {
      setBrowserPage(undefined);
      return;
    }
    void backend
      .browse(browserKind, browserPackage, browserOffset)
      .then((page) => {
        if (active) setBrowserPage(page);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [project, browserKind, browserPackage, browserOffset]);

  const capture = (): NavigationFrame | undefined =>
    request && project
      ? {
          snapshot: project.snapshot,
          request,
          selectedId: selected?.id,
          viewport: flow.current?.getViewport(),
          trail,
          outcomeId,
          calls,
          continuationCallId,
          positions: Object.fromEntries(
            [...positions.current].filter(([id]) => view?.nodes.some((node) => node.id === id)),
          ),
        }
      : undefined;

  const navigate = (next: GraphRequest, record = true) => {
    const frame = capture();
    if (record && frame) {
      setHistory((previous) => [...previous.slice(-19), frame]);
      setFuture([]);
    }
    if (next.focus !== request?.focus) {
      setTrail(undefined);
      setOutcomeId(undefined);
      pendingSelection.current = next.focus;
      setPinned(false);
    }
    setContinuationCallId(undefined);
    setImpact('');
    setRequest(boundRequest(next));
  };

  const restore = (frame: NavigationFrame) => {
    if (!frameMatchesSnapshot(frame, project?.snapshot)) {
      setNavigationNotice(
        'Saved navigation belongs to an older analysis. Start again from the current symbol.',
      );
      return;
    }
    restored.current = frame;
    for (const [id, position] of Object.entries(frame.positions ?? {}))
      positions.current.set(id, position);
    setTrail(frame.trail);
    setOutcomeId(frame.outcomeId);
    setCalls(frame.calls ?? []);
    setContinuationCallId(frame.continuationCallId);
    pendingSelection.current = frame.selectedId;
    navigate(frame.request, false);
    setTrail(frame.trail);
    setOutcomeId(frame.outcomeId);
    setContinuationCallId(frame.continuationCallId);
  };

  const focusSymbol = (id: string, kind?: string) => {
    const fact =
      view?.nodes.find((node) => node.id === id) ?? matches.find((node) => node.id === id);
    navigate(requestFor(id, kind ?? fact?.kind, preferences.current));
  };

  const loadProject = async (refresh = false) => {
    const current = projectLatest.current.next();
    const previousFrame = capture();
    latest.current.invalidate();
    searchLatest.current.invalidate();
    sourceLatest.current.invalidate();

    setBusy(true);
    setError('');
    setExcerpt(undefined);
    setSelected(undefined);
    setHovered(undefined);
    setPinned(false);
    setNavigationNotice('');
    restored.current = undefined;
    pendingFlow.current = undefined;
    pendingSelection.current = undefined;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);

    // Old facts are removed while a replacement snapshot is being analyzed.
    setView(undefined);
    setNodes([]);
    setEdges([]);

    try {
      const summary = await (refresh ? backend.refresh() : backend.open(root));
      if (!current()) return;

      setProject(summary);
      if (isDesktop) {
        const next = [summary.root, ...recents.filter((path) => path !== summary.root)].slice(0, 8);
        setRecents(next);
        try {
          localStorage.setItem('sonar.recentPaths', JSON.stringify(next));
        } catch {
          /* Recent paths are optional when storage is unavailable. */
        }
      }
      if (refresh && request) {
        const navigation = refreshNavigation(
          { request, history, future, trail, calls, outcomeId, continuationCallId },
          project?.snapshot,
          summary.snapshot,
        );
        setRequest({ ...navigation.request! });
        setHistory(navigation.history);
        setFuture(navigation.future);
        setTrail(navigation.trail);
        setCalls(navigation.calls);
        setOutcomeId(navigation.outcomeId);
        setContinuationCallId(navigation.continuationCallId);
        if (summary.snapshot !== project?.snapshot) {
          positions.current.clear();
          framedFocus.current = undefined;
          setNavigationNotice(
            'Analysis changed. Saved paths, call frames, and history were cleared. Start following from the current symbol.',
          );
        } else if (previousFrame) restored.current = previousFrame;
      } else {
        positions.current.clear();
        setHistory([]);
        setFuture([]);
        setCalls([]);
        setTrail(undefined);
        setContinuationCallId(undefined);
        setOutcomeId(undefined);
        framedFocus.current = undefined;
        restored.current = undefined;
        pendingFlow.current = undefined;
        setBrowserPackage('');
        setBrowserKind('');
        setBrowserOffset(0);
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
            role: node.details?.role,
            width: grouped.has(node.id) ? 650 : 220,
            height: grouped.has(node.id) ? 450 : 88,
            position: sameGroup && old ? { x: old.x, y: old.y } : undefined,
          };
        }),
        edges: result.edges.map(({ id, source, target, kind, label, loopBack }) => ({
          id,
          source,
          target,
          kind,
          label,
          loopBack,
        })),
      });
      const layoutMs = performance.now() - layoutStarted;
      if (!current()) return;
      const oldFocus = positions.current.get(result.focus);
      const focusPosition = geometry.positions[result.focus];
      if (oldFocus && framedFocus.current === result.focus) {
        const dx = oldFocus.x - focusPosition.x;
        const dy = oldFocus.y - focusPosition.y;
        for (const node of result.nodes.filter((node) => !node.parentId)) {
          geometry.positions[node.id].x += dx;
          geometry.positions[node.id].y += dy;
        }
      }
      const selectedId = restored.current?.selectedId ?? pendingSelection.current;
      const initialNavigation = framedFocus.current !== result.focus;

      let centerId: string | undefined =
        pendingSelection.current &&
        result.nodes.find((node) => node.id === pendingSelection.current)?.parentId
          ? pendingSelection.current
          : undefined;
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
              ? `${summary.distinctSymbols ?? 0} symbols · ${summary.sourceSites ?? summary.incoming + summary.outgoing} source sites${summary.hidden ? ` · ${summary.hidden} hidden` : ''}`
              : '';

            return {
              id: node.id,
              type: 'symbol',
              ariaLabel: `${node.kind}: ${node.name}`,
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
                role: node.parentId ? (node.details?.role ?? node.kind) : undefined,
                join: node.details?.join,
                limitation: node.details?.limitation,
              },
            };
          }),
        );

        setEdges(
          result.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.loopBack
              ? `${edge.label || 'continue'} · loop back`
              : edge.label || edge.kind,
            ariaLabel: `${result.nodes.find((node) => node.id === edge.source)?.name} to ${result.nodes.find((node) => node.id === edge.target)?.name}: ${edge.label || edge.kind}`,
            type: edge.loopBack ? 'smoothstep' : 'default',
            sourceHandle:
              edge.kind !== 'control' &&
              result.nodes.find((node) => node.id === edge.source)?.parentId
                ? 'dependency'
                : ['true', 'iterate', 'next item'].includes(edge.label)
                  ? 'branch-true'
                  : ['false', 'done'].includes(edge.label)
                    ? 'branch-false'
                    : undefined,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: {
              stroke:
                edge.kind === 'data' ? '#9e61cf' : edge.kind === 'control' ? '#277e88' : '#52647d',
              strokeDasharray: edge.certainty === 'possible' || edge.loopBack ? '6 4' : undefined,
            },
            labelStyle: { fontSize: 11 },
            reconnectable: false,
          })),
        );

        setView(result);
        setSelected((previous) => {
          const id = selectedId ?? (initialNavigation ? result.focus : previous?.id);
          return (
            result.nodes.find((node) => node.id === id) ??
            result.edges.find((edge) => edge.id === id)
          );
        });
        if (pendingFlow.current) {
          const pending = pendingFlow.current;
          const id =
            pending.nodeId ??
            result.behaviors?.find((b) => b.symbolId === pending.functionId)?.entryId ??
            result.nodes.find(
              (node) => node.parentId === pending.functionId && node.kind === 'entry',
            )?.id;
          if (id && result.nodes.some((node) => node.id === id)) {
            setTrail((previous) =>
              previous?.functionId === pending.functionId && pending.nodeId
                ? {
                    ...previous,
                    steps: [
                      ...previous.steps.slice(0, -1),
                      { ...previous.steps.at(-1)!, nodeId: id },
                    ],
                  }
                : { functionId: pending.functionId, steps: [{ nodeId: id }] },
            );
            setSelected(result.nodes.find((node) => node.id === id));
            centerId = id;
          }
          pendingFlow.current = undefined;
        }
        pendingSelection.current = undefined;
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

          if (restored.current?.viewport)
            await flow.current.setViewport(restored.current.viewport, { duration: 0 });
          else if (centerId) {
            const node = result.nodes.find((node) => node.id === centerId)!;
            const at = geometry.positions[centerId];
            const parent = node.parentId ? geometry.positions[node.parentId] : undefined;
            const size = geometry.sizes[centerId];
            await flow.current.setCenter(
              at.x + (parent?.x ?? 0) + size.width / 2,
              at.y + (parent?.y ?? 0) + 50,
              { zoom: 1, duration: 0 },
            );
          } else if (initialNavigation) {
            const size = geometry.sizes[result.focus];
            const bounds = canvas.current?.getBoundingClientRect();
            if (bounds)
              await flow.current.setViewport(
                focusViewport(geometry.positions[result.focus], size.width, bounds),
                { duration: 0 },
              );
          }
          framedFocus.current = result.focus;
          restored.current = undefined;
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

  const inspect = async (span: SourceSpan) => {
    const current = sourceLatest.current.next();
    setExcerpt(undefined);
    setEvidence(span);
    try {
      const result = await backend.source(span);
      if (current()) setExcerpt(result);
    } catch (err) {
      if (current()) setError(String(err));
    }
  };

  const select = (value: ViewNode | ViewEdge) => {
    sourceLatest.current.invalidate();
    setSelected(value);
    setPinned(true);
    setHovered(undefined);
    setExcerpt(undefined);
  };

  const change = (updates: Partial<GraphRequest>) => {
    if (!request) return;
    const next = {
      ...request,
      ...updates,
      ...((updates.kinds || updates.direction) && !updates.offsets ? { offsets: {} } : {}),
    };
    if (updates.kinds || updates.direction || updates.neighborLimit)
      preferences.current = {
        kinds: next.kinds,
        direction: next.direction,
        neighborLimit: next.neighborLimit,
      };
    if (updates.internals && trail && !updates.internals.includes(trail.functionId)) {
      setTrail(undefined);
      setOutcomeId(undefined);
    }
    navigate(next);
  };

  const showNode = (node: ViewNode) => {
    const at = positions.current.get(node.id);
    if (!at) return;
    const parent = node.parentId ? positions.current.get(node.parentId) : undefined;
    void flow.current?.setCenter(
      at.x + (parent?.x ?? 0) + at.width / 2,
      at.y + (parent?.y ?? 0) + Math.min(at.height, 100) / 2,
      { zoom: 1, duration: 0 },
    );
  };

  const startFlow = (id: string) => {
    if (!request || busy) return;
    setOutcomeId(undefined);
    setContinuationCallId(undefined);
    const entry =
      view?.behaviors?.find((b) => b.symbolId === id)?.entryId ??
      view?.nodes.find((node) => node.parentId === id && node.kind === 'entry')?.id;
    if (entry && view?.nodes.some((node) => node.id === entry)) {
      setTrail({ functionId: id, steps: [{ nodeId: entry }] });
      const node = view.nodes.find((node) => node.id === entry)!;
      select(node);
      showNode(node);
    } else {
      pendingFlow.current = { functionId: id };
      change({ internals: [...new Set([...request.internals.slice(-15), id])] });
    }
  };

  const reveal = (node: ViewNode) => {
    if (!request || busy) return;
    pendingFlow.current = flowAfterReveal(trail, node);
    if (!pendingFlow.current) pendingSelection.current = node.details?.region?.firstNodeId;
    change(revealRegion(request, node));
  };

  const step = (edge: ViewEdge) => {
    if (!view || !trail || busy) return;
    const next = followEdge(view, trail, edge.id);
    setTrail(next);
    setOutcomeId(undefined);
    setContinuationCallId(undefined);
    if (edge.hiddenTargetId && request) {
      pendingFlow.current = { functionId: trail.functionId, nodeId: edge.hiddenTargetId };
      change({
        behaviorAnchors: { ...request.behaviorAnchors, [trail.functionId]: edge.hiddenTargetId },
      });
    } else {
      const node = view.nodes.find((node) => node.id === edge.target);
      if (node) {
        select(node);
        showNode(node);
      }
    }
  };

  const enterCall = (node: ViewNode) => {
    if (!canEnterCall(node) || calls.length >= MAX_CALL_DEPTH || !view || busy) return;
    const frame = capture();
    if (!frame) return;
    setCalls([
      ...calls,
      {
        ...frame,
        callId: node.id,
        expression: node.details?.expression ?? node.name,
        sourceLine: node.source.line,
        targetId: node.relatedSymbolId!,
        continuationIds: successors(view, node.id).map((edge) => edge.target),
      },
    ]);
    navigate({
      ...requestFor(node.relatedSymbolId!, 'function', preferences.current),
      internals: [node.relatedSymbolId!],
    });
    pendingFlow.current = { functionId: node.relatedSymbolId! };
  };

  const returnToCaller = () => {
    const frame = calls.at(-1);
    if (!frame || busy) return;
    setCalls(calls.slice(0, -1));
    restore({ ...frame, selectedId: frame.callId, continuationCallId: frame.callId });
  };

  const compareOutcome = (node: ViewNode) => {
    if (!request || busy || !node.parentId) return;
    setTrail(undefined);
    setContinuationCallId(undefined);
    setOutcomeId(node.id);
    select(node);
    if (!view?.nodes.some((candidate) => candidate.id === node.id)) {
      pendingSelection.current = node.id;
      change({ behaviorAnchors: { ...request.behaviorAnchors, [node.parentId]: node.id } });
    } else showNode(node);
  };

  const peek = (value?: ViewNode | ViewEdge) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (value) setHovered(value);
    else hoverTimer.current = setTimeout(() => setHovered(undefined), 180);
  };

  const keyboardIdentity = (event: React.FocusEvent<HTMLDivElement>) => {
    const id = (event.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id');
    const value =
      view?.nodes.find((node) => node.id === id) ?? view?.edges.find((edge) => edge.id === id);
    if (value) peek(value);
  };

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHovered(undefined);
        setPinned(false);
        setSelected(undefined);
        setExcerpt(undefined);
        sourceLatest.current.invalidate();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('keydown', dismiss);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const onNodesChange = (changes: NodeChange<SymbolNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));

    for (const change of changes)
      if (change.type === 'position' && change.position) {
        const old = positions.current.get(change.id);
        if (old) positions.current.set(change.id, { ...old, ...change.position });
      }
  };

  const comparedFunction =
    view?.behaviors?.find((behavior) => behavior.returns.some((node) => node.id === outcomeId))
      ?.symbolId ?? view?.nodes.find((node) => node.id === outcomeId)?.parentId;
  const comparedPaths =
    outcomeId && view ? outcomePaths(view, comparedFunction ?? view.focus, outcomeId) : undefined;
  const activeOperation = currentOperation(trail, continuationCallId);

  const statusLabel = busy
    ? 'Analyzing / laying out…'
    : view
      ? `${view.nodes.length} nodes · ${view.edges.length} edges${view.truncated ? ' · view limit reached' : ''}`
      : 'Choose a project, then a symbol';

  return (
    <div className={`app ${wideSource ? 'wide-source' : ''}`}>
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
        {isDesktop && (
          <button
            disabled={busy}
            onClick={() => {
              void chooseProjectFolder()
                .then((path) => {
                  if (path) setRoot(path);
                })
                .catch((error) => setError(String(error)));
            }}
          >
            Choose folder
          </button>
        )}
        {isDesktop && !!recents.length && (
          <select
            aria-label="Recent projects"
            value=""
            onChange={(event) => setRoot(event.target.value)}
          >
            <option value="">Recent projects</option>
            {recents.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        )}
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
                onClick={() => focusSymbol(symbol.id, symbol.kind)}
              >
                <strong>{symbol.name}</strong>
                <small>
                  {symbol.kind} · {symbol.packageId}
                </small>
              </button>
            ))}
          </div>
          {searching && <p role="status">Searching symbols…</p>}
          {project && !searching && !matches.length && (
            <p className="muted">No matching symbols in the covered analysis.</p>
          )}
          {project && !request && (
            <section className="first-exploration">
              <h3>Choose a starting point</h3>
              {discovery?.entrypoints.map((symbol) => (
                <button
                  className="match"
                  key={symbol.id}
                  onClick={() => focusSymbol(symbol.id, symbol.kind)}
                >
                  <strong>Executable entry: {symbol.name}</strong>
                  <small>{symbol.packageId}</small>
                </button>
              ))}
              <p className="muted">
                {discovery?.entrypoints.length
                  ? 'Start at an entry or browse any declaration below.'
                  : 'Library module. Browse packages, types, or functions below.'}
              </p>
            </section>
          )}
          {project && (
            <details>
              <summary>Browse packages and declarations</summary>
              <label>
                Package
                <input
                  list="project-packages"
                  value={browserPackage}
                  onChange={(event) => {
                    setBrowserPackage(event.target.value);
                    setBrowserOffset(0);
                  }}
                  placeholder="All packages"
                />
                <datalist id="project-packages">
                  {discovery?.packages.map((pkg) => (
                    <option value={pkg} key={pkg} />
                  ))}
                </datalist>
              </label>
              {discovery && discovery.packageCount > discovery.packages.length && (
                <p className="muted">
                  {discovery.packageCount} packages. Enter a package path to browse one outside
                  these suggestions.
                </p>
              )}
              <label>
                Declaration kind
                <select
                  value={browserKind}
                  onChange={(event) => {
                    setBrowserKind(event.target.value);
                    setBrowserOffset(0);
                  }}
                >
                  <option value="">All kinds</option>
                  {[
                    'function',
                    'method',
                    'struct',
                    'interface',
                    'type',
                    'field',
                    'variable',
                    'constant',
                  ].map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              {browserPage?.symbols.map((symbol) => (
                <button
                  key={symbol.id}
                  className="match"
                  onClick={() => focusSymbol(symbol.id, symbol.kind)}
                >
                  {symbol.name}
                  <small>
                    {symbol.kind} · {symbol.packageId}
                  </small>
                </button>
              ))}
              <p>{browserPage?.total ?? 0} declarations</p>
              <div className="actions">
                <button
                  disabled={!browserOffset}
                  onClick={() => setBrowserOffset(Math.max(0, browserOffset - 40))}
                >
                  Previous declarations
                </button>
                <button
                  disabled={
                    !browserPage || browserOffset + browserPage.symbols.length >= browserPage.total
                  }
                  onClick={() => setBrowserOffset(browserOffset + 40)}
                >
                  More declarations
                </button>
              </div>
            </details>
          )}
          <h3>Explore a question</h3>
          <div className="questions">
            <button
              disabled={!request || busy}
              onClick={() => change({ kinds: ['calls'], direction: 'outgoing', groups: {} })}
            >
              What does this call?
            </button>
            <button
              disabled={!request || busy}
              onClick={() => change({ kinds: ['calls'], direction: 'incoming', groups: {} })}
            >
              Who calls this?
            </button>
            <button disabled={!request || busy} onClick={() => startFlow(request!.focus)}>
              How does this work?
            </button>
          </div>
          <h3>Relationships</h3>
          {RELATIONS.map((kind) => (
            <label className="checkbox" key={kind}>
              <input
                type="checkbox"
                checked={request?.kinds.includes(kind) ?? kind === 'calls'}
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
              value={request?.direction ?? 'outgoing'}
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
                const previous = history.at(-1)!;
                const frame = capture();
                setHistory(history.slice(0, -1));
                if (frame) setFuture([...future.slice(-19), frame]);
                restore(previous);
              }}
            >
              Back
            </button>
            <button
              disabled={!future.length || busy}
              onClick={() => {
                const next = future.at(-1)!;
                const frame = capture();
                setFuture(future.slice(0, -1));
                if (frame) setHistory([...history.slice(-19), frame]);
                restore(next);
              }}
            >
              Forward
            </button>
            <button
              disabled={!view}
              onClick={() => {
                const focus = view?.nodes.find((node) => node.id === view.focus);
                if (focus) showNode(focus);
              }}
            >
              Center focus
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
              onClick={() =>
                change({
                  expanded: [],
                  internals: [],
                  offsets: {},
                  regions: [],
                  behaviorAnchors: {},
                  groups: {},
                })
              }
            >
              Collapse branches
            </button>
            <span role="status">{statusLabel}</span>
          </div>
          {navigationNotice && (
            <div className="notice" role="status">
              {navigationNotice}
            </div>
          )}
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
          <FlowNavigator
            view={view}
            request={request}
            trail={trail}
            calls={calls}
            outcomeId={outcomeId}
            outcomePartial={comparedPaths?.partial}
            continuationCallId={continuationCallId}
            functionId={
              comparedFunction ??
              selectedNode?.parentId ??
              (view?.behaviors?.some((b) => b.symbolId === selectedNode?.id)
                ? selectedNode?.id
                : undefined)
            }
            onStart={startFlow}
            onStep={step}
            onBack={() => {
              if (!trail || busy) return;
              setContinuationCallId(undefined);
              const steps = trail.steps.slice(0, -1);
              setTrail({ ...trail, steps });
              const id = steps.at(-1)?.nodeId;
              const node = view?.nodes.find((node) => node.id === id);
              if (node) {
                select(node);
                showNode(node);
              } else if (id && request) {
                pendingFlow.current = { functionId: trail.functionId, nodeId: id };
                change({ behaviorAnchors: { ...request.behaviorAnchors, [trail.functionId]: id } });
              }
            }}
            onReveal={reveal}
            onOutcome={compareOutcome}
            onOutcomePage={(id, offset) =>
              change({ outcomeOffsets: { ...request?.outcomeOffsets, [id]: offset } })
            }
            onReturn={returnToCaller}
            onStop={() => {
              setTrail(undefined);
              setOutcomeId(undefined);
              setContinuationCallId(undefined);
            }}
          />
          <div
            className="canvas"
            ref={canvas}
            onFocusCapture={keyboardIdentity}
            onKeyDownCapture={(event) => {
              if (
                event.key === 'Enter' &&
                hovered &&
                (event.target as HTMLElement).closest('[data-id]')
              ) {
                event.preventDefault();
                select(hovered);
              }
            }}
          >
            <ReactFlow<SymbolNode>
              nodes={nodes.map((node) => {
                const paths = comparedPaths;
                return {
                  ...node,
                  selected: selected?.id === node.id,
                  className: `${activeOperation === node.id ? 'current-operation' : ''} ${paths && node.parentId && !paths.nodes.has(node.id) ? 'dimmed' : ''}`,
                };
              })}
              edges={edges.map((edge) => {
                const paths = comparedPaths;
                const current = activeOperation;
                return {
                  ...edge,
                  selected: selected?.id === edge.id,
                  className:
                    paths && !paths.edges.has(edge.id)
                      ? 'dimmed'
                      : view?.edges.some(
                            (candidate) =>
                              candidate.id === edge.id &&
                              candidate.source === current &&
                              candidate.kind === 'control',
                          )
                        ? 'next-operation'
                        : '',
                };
              })}
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
              onNodeMouseEnter={(_, node) =>
                peek(view?.nodes.find((value) => value.id === node.id))
              }
              onNodeMouseLeave={() => peek()}
              onEdgeMouseEnter={(_, edge) =>
                peek(view?.edges.find((value) => value.id === edge.id))
              }
              onEdgeMouseLeave={() => peek()}
              onNodeDoubleClick={(_, node) => {
                const fact = view?.nodes.find((value) => value.id === node.id);

                if (fact) {
                  if (canEnterCall(fact)) enterCall(fact);
                  else focusSymbol(fact.parentId ?? fact.id, fact.kind);
                }
              }}
              nodesConnectable={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              onlyRenderVisibleElements
              minZoom={0.15}
              maxZoom={2}
              onPaneClick={() => {
                setHovered(undefined);
                setPinned(false);
              }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
            {(hovered || (pinned && selected)) && (
              <div
                onMouseEnter={() => {
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                }}
                onMouseLeave={() => peek()}
              >
                <IdentityCard
                  value={hovered ?? selected!}
                  nodes={view?.nodes ?? []}
                  pinned={pinned && selected?.id === (hovered ?? selected)?.id}
                  onPin={() => {
                    const value = hovered ?? selected;
                    if (value) select(value);
                  }}
                  onDismiss={() => {
                    setHovered(undefined);
                    setPinned(false);
                  }}
                />
              </div>
            )}
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
            <details className="diagnostics">
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
          <button className="source-width" onClick={() => setWideSource(!wideSource)}>
            {wideSource ? 'Compact source panel' : 'Widen source panel'}
          </button>
          <EvidenceInspector
            selected={selected}
            summary={selectedSummary}
            view={view}
            request={request}
            root={project?.root}
            busy={busy}
            impact={impact}
            excerpt={excerpt}
            evidence={evidence}
            callDepth={calls.length}
            onFocus={focusSymbol}
            onUsage={(id) => navigate(requestFor(id, 'field'))}
            onChange={change}
            onEnter={enterCall}
            onFollow={startFlow}
            onReveal={reveal}
            onSelect={select}
            onSource={(span) => void inspect(span)}
            onImpact={(id, category) => {
              if (request) {
                navigate({ ...request, focus: id });
                setImpact(category);
              }
            }}
            onPage={(direction) => {
              if (request && selectedNode && selectedSummary)
                navigate(neighborPage(request, selectedNode.id, selectedSummary, direction));
            }}
            onShow={showNode}
          />
        </aside>
      </div>
    </div>
  );
}
