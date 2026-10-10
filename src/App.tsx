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
import { ConnectionSummary } from './ConnectionSummary';
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
  operationViewport,
  MAX_CALL_DEPTH,
  explorationDestination,
  explorationBreadcrumbs,
  collapseBranch,
  resetToFocus,
  replacedOperations,
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
  categoryFor,
  QUESTIONS,
  revealGroup,
  clearGroup,
  type ExplorationCategory,
  type ExplorationPreferences,
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
  const [overviewFunctionId, setOverviewFunctionId] = useState<string>();
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [keepStepCentered, setKeepStepCentered] = useState(false);
  const keepStepCenteredRef = useRef(false);
  keepStepCenteredRef.current = keepStepCentered;

  const [view, setView] = useState<GraphView>();
  const [nodes, setNodes] = useState<SymbolNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [selected, setSelected] = useState<ViewNode | ViewEdge>();
  const [excerpt, setExcerpt] = useState<SourceExcerpt>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [impact, setImpact] = useState('');
  const [navigationNotice, setNavigationNotice] = useState('');
  const [resetPreview, setResetPreview] = useState(false);
  const [animateLayout, setAnimateLayout] = useState(false);
  const layoutAnimationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const viewRef = useRef(view);
  viewRef.current = view;
  const pendingLayoutAnchor = useRef<
    | {
        id: string;
        position: { x: number; y: number; width: number; height: number; parentId?: string };
      }
    | undefined
  >(undefined);

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
  const preferences = useRef<Partial<Record<ExplorationCategory, ExplorationPreferences>>>({});
  const focusKind = useRef('function');
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    layout.current = new LayoutClient();
    window.__SONAR_METRICS__.ready = true;

    return () => {
      latest.current.invalidate();
      layout.current?.dispose();
      if (layoutAnimationTimer.current) clearTimeout(layoutAnimationTimer.current);
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
          focusLabel: view?.nodes.find((node) => node.id === request.focus)?.name,
          focusLine: view?.nodes.find((node) => node.id === request.focus)?.source.line,
          viewport: flow.current?.getViewport(),
          trail,
          overviewFunctionId,
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
      pendingLayoutAnchor.current = undefined;
      setOverviewFunctionId(undefined);
      setTrail(undefined);
      setOutcomeId(undefined);
      pendingSelection.current = next.focus;
      setPinned(false);
    }
    setContinuationCallId(undefined);
    setResetPreview(false);
    setNavigationNotice('');
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
    pendingLayoutAnchor.current = undefined;
    restored.current = frame;
    for (const [id, position] of Object.entries(frame.positions ?? {}))
      positions.current.set(id, position);
    focusKind.current =
      view?.nodes.find((node) => node.id === frame.request.focus)?.kind ?? focusKind.current;
    setTrail(frame.trail);
    setOutcomeId(frame.outcomeId);
    setCalls(frame.calls ?? []);
    setContinuationCallId(frame.continuationCallId);
    pendingSelection.current = frame.selectedId;
    navigate(frame.request, false);
    setOverviewFunctionId(frame.overviewFunctionId);
    setTrail(frame.trail);
    setOutcomeId(frame.outcomeId);
    setContinuationCallId(frame.continuationCallId);
  };

  const focusSymbol = (id: string, kind?: string) => {
    const fact =
      view?.nodes.find((node) => node.id === id) ?? matches.find((node) => node.id === id);
    const nextKind = kind ?? fact?.kind ?? 'function';
    focusKind.current = nextKind;
    navigate(requestFor(id, nextKind, preferences.current[categoryFor(nextKind)]));
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
    pendingLayoutAnchor.current = undefined;
    setResetPreview(false);
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
          setOverviewFunctionId(undefined);
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
        setOverviewFunctionId(undefined);
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

      const previousView = viewRef.current;
      const anchor = pendingLayoutAnchor.current;
      const layoutStarted = performance.now();
      const geometry: LayoutResult = await layout.current!.layout({
        anchorId:
          anchor?.id ??
          (result.nodes.some((node) => node.id === selectedRef.current?.id)
            ? selectedRef.current?.id
            : result.focus),
        nodes: result.nodes.map((node) => {
          const old = anchor?.id === node.id ? anchor.position : positions.current.get(node.id);
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
      pendingLayoutAnchor.current = undefined;
      const selectedId = restored.current?.selectedId ?? pendingSelection.current;
      const initialNavigation = framedFocus.current !== result.focus;
      const newlyRevealed = new Set(
        !initialNavigation && !restored.current
          ? result.nodes
              .filter((node) => !previousView?.nodes.some((old) => old.id === node.id))
              .map((node) => node.id)
          : [],
      );
      const replaced = replacedOperations(previousView, result);
      if (!restored.current && replaced.count)
        setNavigationNotice(
          `${replaced.count} previously visible operations in ${replaced.functions.join(', ')} were collapsed or moved outside this view to stay within the view budget. Previous exploration restores them.`,
        );
      if (layoutAnimationTimer.current) clearTimeout(layoutAnimationTimer.current);
      setAnimateLayout(
        !initialNavigation && !restored.current && mode === 'frames' && !benchmarking.current,
      );
      layoutAnimationTimer.current = setTimeout(() => setAnimateLayout(false), 220);

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
              ariaLabel: `${node.kind}: ${node.name}${newlyRevealed.has(node.id) ? ' · newly revealed' : ''}`,
              parentId: node.parentId,
              extent: node.parentId ? ('parent' as const) : undefined,
              position,
              width: size.width,
              height: size.height,
              style: size,
              data: {
                label: node.name,
                newlyRevealed: newlyRevealed.has(node.id),
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
        focusKind.current =
          result.nodes.find((node) => node.id === result.focus)?.kind ?? 'function';
        setSelected((previous) => {
          const id = selectedId ?? (initialNavigation ? result.focus : previous?.id);
          return (
            result.nodes.find((node) => node.id === id) ??
            result.edges.find((edge) => edge.id === id)
          );
        });
        if (pendingFlow.current) {
          const pending = pendingFlow.current;
          setOverviewFunctionId(pending.functionId);
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
        sourceLatest.current.invalidate();
        setEvidence(undefined);
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
            const bounds = canvas.current?.getBoundingClientRect();
            if (bounds)
              await flow.current.setViewport(
                operationViewport(
                  flow.current.getViewport(),
                  { x: at.x + (parent?.x ?? 0), y: at.y + (parent?.y ?? 0), ...size },
                  bounds,
                  keepStepCenteredRef.current,
                ),
                { duration: 0 },
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
    setEvidence(undefined);
    setPinned(true);
    setHovered(undefined);
    setExcerpt(undefined);
  };

  const change = (updates: Partial<GraphRequest>, preserveTrail = false) => {
    if (!request) return;
    const next = {
      ...request,
      ...updates,
      ...((updates.kinds || updates.direction) && !updates.offsets ? { offsets: {} } : {}),
    };
    if (updates.kinds || updates.direction || updates.neighborLimit || 'neighborKind' in updates)
      preferences.current[categoryFor(focusKind.current)] = {
        kinds: next.kinds,
        direction: next.direction,
        neighborLimit: next.neighborLimit,
        neighborKind: next.neighborKind,
      };
    if (
      !preserveTrail &&
      updates.internals &&
      trail &&
      !updates.internals.includes(trail.functionId)
    ) {
      setTrail(undefined);
      setOutcomeId(undefined);
    }
    if (updates.internals) {
      const added = updates.internals.find((id) => !request.internals.includes(id));
      if (added) setOverviewFunctionId(added);
      else if (overviewFunctionId && !updates.internals.includes(overviewFunctionId))
        setOverviewFunctionId(undefined);
    }
    navigate(next);
  };

  const showNode = (node: ViewNode, centered = true) => {
    const at = positions.current.get(node.id);
    const bounds = canvas.current?.getBoundingClientRect();
    if (!at || !bounds || !flow.current) return;
    const parent = node.parentId ? positions.current.get(node.parentId) : undefined;
    const viewport = flow.current.getViewport();
    const next = operationViewport(
      viewport,
      {
        x: at.x + (parent?.x ?? 0),
        y: at.y + (parent?.y ?? 0),
        width: at.width,
        height: Math.min(at.height, 100),
      },
      bounds,
      centered,
    );
    if (next.x !== viewport.x || next.y !== viewport.y)
      void flow.current.setViewport(next, { duration: 0 });
  };

  const openBehavior = (id: string) => {
    if (!request || busy) return;
    setOverviewFunctionId(id);
    if (request.internals.includes(id)) return;
    change({ internals: [...new Set([...request.internals.slice(-15), id])] });
  };

  const returnToStep = () => {
    if (!trail || !request || busy) return;
    const id = trail.steps.at(-1)?.nodeId;
    setContinuationCallId(undefined);
    const node = view?.nodes.find((node) => node.id === id);
    if (node) {
      select(node);
      showNode(node, keepStepCentered);
    } else if (id) {
      pendingFlow.current = { functionId: trail.functionId, nodeId: id };
      change({
        internals: [...new Set([...request.internals.slice(-15), trail.functionId])],
        behaviorAnchors: { ...request.behaviorAnchors, [trail.functionId]: id },
      });
    }
  };

  const startFlow = (id: string) => {
    if (!request || busy) return;
    setOverviewFunctionId(id);
    setOutcomeId(undefined);
    setContinuationCallId(undefined);
    const entry =
      view?.behaviors?.find((b) => b.symbolId === id)?.entryId ??
      view?.nodes.find((node) => node.parentId === id && node.kind === 'entry')?.id;
    if (entry && view?.nodes.some((node) => node.id === entry)) {
      setTrail({ functionId: id, steps: [{ nodeId: entry }] });
      const node = view.nodes.find((node) => node.id === entry)!;
      select(node);
      showNode(node, keepStepCentered);
    } else {
      pendingFlow.current = { functionId: id };
      change({ internals: [...new Set([...request.internals.slice(-15), id])] });
    }
  };

  const reveal = (node: ViewNode) => {
    if (!request || busy) return;
    const at = positions.current.get(node.id);
    if (at && node.details?.region)
      pendingLayoutAnchor.current = { id: node.details.region.firstNodeId, position: at };
    const replacing = (request.regions ?? []).filter(
      (id) => id !== node.id && id.startsWith(`${node.parentId}/behavior/`),
    );
    pendingFlow.current = flowAfterReveal(trail, node);
    if (!pendingFlow.current) pendingSelection.current = node.details?.region?.firstNodeId;
    change(revealRegion(request, node));
    if (replacing.length)
      setNavigationNotice(
        `Revealing this region collapses the previously opened region in ${view?.nodes.find((parent) => parent.id === node.parentId)?.name ?? 'this function'} to stay within the view budget. Previous exploration restores it.`,
      );
  };

  const step = (edge: ViewEdge) => {
    if (!view || !trail || trail.paused || busy) return;
    const next = followEdge(view, trail, edge.id);
    if (next === trail) return;
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
        showNode(node, keepStepCentered);
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
      ...requestFor(node.relatedSymbolId!, 'function', preferences.current.function),
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
    setOverviewFunctionId(node.parentId);
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

  const focusNode = view?.nodes.find((node) => node.id === view.focus);
  const focusCategory = categoryFor(focusNode?.kind ?? focusKind.current);
  const behaviorOpen = !!request?.internals.includes(request.focus);
  const followedNode = view?.nodes.find((node) => node.id === trail?.steps.at(-1)?.nodeId);
  const returnedNode = view?.nodes.find((node) => node.id === continuationCallId);
  const connectionNode = selectedNode && !selectedNode.parentId ? selectedNode : focusNode;
  const connectionSummary = view?.summaries.find(
    (summary) => summary.nodeId === connectionNode?.id,
  );

  const breadcrumbs = explorationBreadcrumbs(history, request?.focus);
  const collapseTarget = selectedNode?.parentId ?? selectedNode?.id;
  const collapseName =
    view?.nodes.find((node) => node.id === collapseTarget)?.name ?? selectedNode?.name;
  const canCollapseSelected =
    !!request &&
    !!collapseTarget &&
    (request.expanded.includes(collapseTarget) ||
      request.internals.includes(collapseTarget) ||
      !!request.groups?.[collapseTarget] ||
      !!request.offsets?.[collapseTarget]);
  const restoreExploration = (index: number) => {
    if (busy) return;
    const destination = history[index];
    const frame = capture();
    if (!destination || !frame) return;
    setHistory(history.slice(0, index));
    setFuture([...future, frame, ...history.slice(index + 1).reverse()].slice(-20));
    restore(destination);
  };

  const statusLabel = busy
    ? 'Analyzing / laying out…'
    : view
      ? `${view.nodes.length} nodes · ${view.edges.length} edges${view.truncated ? ' · view limit reached' : ''}`
      : 'Choose a project, then a symbol';

  return (
    <div
      className={`app ${wideSource ? 'wide-source' : ''} ${inspectorOpen ? '' : 'inspector-closed'}`}
    >
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
          <div className="questions" aria-label="Exploration questions">
            {QUESTIONS[focusCategory].map((question) => (
              <button
                key={question.label}
                disabled={!request || busy || !!impact}
                aria-pressed={
                  !!request &&
                  !behaviorOpen &&
                  request.direction === question.direction &&
                  request.neighborKind === question.neighborKind &&
                  request.kinds.length === question.kinds.length &&
                  question.kinds.every((kind) => request.kinds.includes(kind))
                }
                onClick={() => {
                  if (trail) setTrail({ ...trail, paused: true });
                  setOutcomeId(undefined);
                  change(
                    {
                      kinds: question.kinds,
                      direction: question.direction,
                      neighborKind: question.neighborKind,
                      groups: {},
                      internals: [],
                    },
                    true,
                  );
                }}
              >
                {question.label}
              </button>
            ))}
            {focusCategory === 'function' && (
              <button
                disabled={!request || busy || !!impact}
                aria-pressed={behaviorOpen}
                onClick={() => openBehavior(request!.focus)}
              >
                Flow
              </button>
            )}
          </div>
          {request?.neighborKind && (
            <p className="muted">Methods using this type, including receiver and signature uses.</p>
          )}
          <h3>Relationships</h3>
          {RELATIONS.map((kind) => (
            <label className="checkbox" key={kind}>
              <input
                type="checkbox"
                checked={request?.kinds.includes(kind) ?? kind === 'calls'}
                disabled={!request || busy || !!impact}
                onChange={() =>
                  change({ neighborKind: undefined, kinds: toggleId(request!.kinds, kind) })
                }
              />
              {kind.replace('_', ' ')}
            </label>
          ))}
          <label>
            Neighbor direction
            <select
              disabled={!request || busy || !!impact}
              value={request?.direction ?? 'outgoing'}
              onChange={(event) =>
                change({
                  direction: event.target.value as GraphRequest['direction'],
                  neighborKind: undefined,
                })
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
              title={`Restore ${explorationDestination(history.at(-1))}`}
              onClick={() => restoreExploration(history.length - 1)}
            >
              Previous exploration
            </button>
            <button
              disabled={!future.length || busy}
              title={`Restore ${explorationDestination(future.at(-1))}`}
              onClick={() => {
                const next = future.at(-1)!;
                const frame = capture();
                setFuture(future.slice(0, -1));
                if (frame) setHistory([...history.slice(-19), frame]);
                restore(next);
              }}
            >
              Next exploration
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
              disabled={!canCollapseSelected || busy || !!impact}
              title={
                collapseName
                  ? `Close ${collapseName}'s behavior and expanded neighbors only. Other branches stay open.`
                  : 'Select an expanded declaration or its operation'
              }
              onClick={() => {
                if (!request || !selectedNode) return;
                pendingSelection.current = collapseTarget;
                if (comparedFunction === collapseTarget) setOutcomeId(undefined);
                change(collapseBranch(request, selectedNode), trail?.functionId !== collapseTarget);
              }}
            >
              Collapse selected branch
            </button>
            <button
              disabled={!request || busy || !!impact}
              aria-expanded={resetPreview}
              aria-controls="reset-preview"
              title="Review what will close before resetting this exploration"
              onClick={() => setResetPreview(!resetPreview)}
            >
              Reset to focus
            </button>
            <button
              disabled={!selected}
              aria-expanded={inspectorOpen}
              aria-controls="evidence-inspector"
              onClick={() => setInspectorOpen(true)}
            >
              Inspect
            </button>
            <span role="status">{statusLabel}</span>
          </div>
          {resetPreview && request && (
            <div
              className="notice reset-preview"
              id="reset-preview"
              role="region"
              aria-label="Reset exploration"
            >
              <p>
                Reset to {focusNode?.name ?? 'the focused declaration'} closes{' '}
                {request.expanded.length} expanded neighbor branches and {request.internals.length}{' '}
                function behaviors. It clears package filters, region and page detail, and ends
                walkthrough and call navigation. Relationship filters and saved explorations remain
                available.
              </p>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    pendingFlow.current = undefined;
                    pendingLayoutAnchor.current = undefined;
                    pendingSelection.current = request.focus;
                    setCalls([]);
                    setTrail(undefined);
                    setOutcomeId(undefined);
                    setOverviewFunctionId(undefined);
                    setContinuationCallId(undefined);
                    change(resetToFocus(request));
                  }}
                >
                  Apply reset
                </button>
                <button onClick={() => setResetPreview(false)}>Keep exploration</button>
              </div>
            </div>
          )}
          {view && (
            <nav className="exploration-breadcrumb" aria-label="Exploration breadcrumb">
              <ol>
                {breadcrumbs.map(({ frame, index }) => (
                  <li key={index}>
                    <button
                      disabled={busy}
                      title={`Restore ${explorationDestination(frame)}`}
                      onClick={() => restoreExploration(index)}
                    >
                      {frame.focusLabel ?? frame.request.focus}
                    </button>
                  </li>
                ))}
                <li aria-current="location">{focusNode?.name ?? view.focus}</li>
              </ol>
            </nav>
          )}
          {view && (
            <div className="exploration-context" role="status">
              <span>Exploring {focusNode?.name ?? view.focus}</span>
              {trail && (
                <span>
                  {trail.paused ? 'Paused at' : 'Following'}{' '}
                  {followedNode
                    ? `line ${followedNode.source.line} · ${followedNode.name}`
                    : 'a hidden operation'}
                </span>
              )}
              {continuationCallId && (
                <span>
                  Returned to {returnedNode?.name ?? 'call'} · line{' '}
                  {returnedNode?.source.line ?? '?'}
                </span>
              )}
              {selected && (
                <span>
                  {inspectorOpen ? 'Inspecting' : 'Selected'}{' '}
                  {selectedNode?.name ??
                    ('label' in selected ? selected.label || selected.kind : selected.kind)}
                </span>
              )}
              {trail && selected?.id !== followedNode?.id && (
                <button disabled={busy} onClick={returnToStep}>
                  Return to current step
                </button>
              )}
            </div>
          )}
          {connectionNode && connectionSummary && request && (
            <ConnectionSummary
              node={connectionNode}
              summary={connectionSummary}
              view={view!}
              request={request}
              busy={busy || !!impact}
              onChange={change}
              onRequest={(next) => navigate(next)}
            />
          )}
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
            busy={busy || !!impact}
            keepStepCentered={keepStepCentered}
            onKeepStepCentered={setKeepStepCentered}
            onResume={() => {
              if (trail && !busy) {
                setTrail({ ...trail, paused: false });
                returnToStep();
              }
            }}
            onPause={() => {
              if (trail && !busy) setTrail({ ...trail, paused: true });
            }}
            functionId={
              comparedFunction ?? overviewFunctionId ?? (behaviorOpen ? request?.focus : undefined)
            }
            onStart={startFlow}
            onStep={step}
            onBack={() => {
              if (!trail || trail.paused || busy) return;
              setContinuationCallId(undefined);
              const steps = trail.steps.slice(0, -1);
              setTrail({ ...trail, steps });
              const id = steps.at(-1)?.nodeId;
              const node = view?.nodes.find((node) => node.id === id);
              if (node) {
                select(node);
                showNode(node, keepStepCentered);
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
            className={`canvas ${animateLayout ? 'layout-changing' : ''}`}
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
                  className: `${node.data.newlyRevealed ? 'newly-revealed' : ''} ${activeOperation === node.id ? 'current-operation' : ''} ${paths && node.parentId && !paths.nodes.has(node.id) ? 'dimmed' : ''}`,
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
                  select(fact);
                  setInspectorOpen(true);
                }
              }}
              onEdgeDoubleClick={(_, edge) => {
                const fact = view?.edges.find((value) => value.id === edge.id);
                if (fact) {
                  select(fact);
                  setInspectorOpen(true);
                }
              }}
              zoomOnDoubleClick={false}
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
                  onInspect={() => {
                    const value = hovered ?? selected;
                    if (value) {
                      select(value);
                      setInspectorOpen(true);
                    }
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
        {inspectorOpen && (
          <aside className="inspector" id="evidence-inspector" aria-label="Evidence inspector">
            <button onClick={() => setInspectorOpen(false)}>Close inspector</button>
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
              onUsage={(id) => focusSymbol(id, 'field')}
              onChange={change}
              onEnter={enterCall}
              onFollow={openBehavior}
              onGroup={(nodeId, group) => {
                if (request) navigate(revealGroup(request, nodeId, group));
              }}
              onClearGroup={(nodeId) => {
                if (request) navigate(clearGroup(request, nodeId));
              }}
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
              onShow={(node) => showNode(node)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
