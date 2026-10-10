import type { GraphRequest, GraphView, ViewEdge, ViewNode } from './shared/protocol';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export interface FlowStep {
  nodeId: string;
  edgeId?: string;
  condition?: string;
  branch?: string;
}
export interface FlowTrail {
  functionId: string;
  steps: FlowStep[];
  paused?: boolean;
}

// Keep the entire operation inside a comfortable area, moving only the necessary axis.
export function operationViewport(
  viewport: Viewport,
  node: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number },
  centered = false,
): Viewport {
  const axis = (pan: number, position: number, size: number, extent: number) => {
    const start = pan + position * viewport.zoom;
    const length = size * viewport.zoom;
    const padding = Math.min(80, extent * 0.15);
    if (centered || length > extent - padding * 2)
      return extent / 2 - (position + size / 2) * viewport.zoom;
    if (start < padding) return pan + padding - start;
    if (start + length > extent - padding) return pan + extent - padding - start - length;
    return pan;
  };
  return {
    x: axis(viewport.x, node.x, node.width, canvas.width),
    y: axis(viewport.y, node.y, node.height, canvas.height),
    zoom: viewport.zoom,
  };
}
export interface NavigationFrame {
  snapshot: string;
  request: GraphRequest;
  selectedId?: string;
  viewport?: Viewport;
  trail?: FlowTrail;
  overviewFunctionId?: string;
  focusLabel?: string;
  focusLine?: number;
  outcomeId?: string;
  calls?: CallFrame[];
  continuationCallId?: string;
  positions?: Record<
    string,
    { x: number; y: number; width: number; height: number; parentId?: string }
  >;
}
export interface CallFrame extends NavigationFrame {
  callId: string;
  expression: string;
  sourceLine: number;
  targetId: string;
  continuationIds: string[];
}

export const MAX_FLOW_STEPS = 120;
export const MAX_CALL_DEPTH = 16;

export function successors(view: GraphView, nodeId: string): ViewEdge[] {
  return view.edges.filter((edge) => edge.kind === 'control' && edge.source === nodeId);
}

export function followEdge(view: GraphView, trail: FlowTrail, edgeId: string): FlowTrail {
  if (trail.steps.length >= MAX_FLOW_STEPS) return trail;
  const current = trail.steps.at(-1)?.nodeId;
  const edge = view.edges.find(
    (edge) => edge.id === edgeId && edge.kind === 'control' && edge.source === current,
  );
  if (!edge) return trail;
  const node = view.nodes.find((node) => node.id === current);
  if (!node || node.parentId !== trail.functionId) return trail;
  const choice = ['condition', 'loop'].includes(node.kind);
  return {
    ...trail,
    steps: [
      ...trail.steps,
      {
        nodeId: edge.target,
        edgeId,
        ...(choice ? { condition: node.details?.expression ?? node.name, branch: edge.label } : {}),
      },
    ],
  };
}

export function outcomePaths(
  view: GraphView,
  functionId: string,
  returnId: string,
): { nodes: Set<string>; edges: Set<string>; partial: boolean } {
  const internal = new Set(
    view.nodes.filter((node) => node.parentId === functionId).map((node) => node.id),
  );
  const control = view.edges.filter(
    (edge) => edge.kind === 'control' && internal.has(edge.source) && internal.has(edge.target),
  );
  const nodes = new Set<string>();
  const queue = [returnId];
  while (queue.length) {
    const id = queue.pop()!;
    if (nodes.has(id)) continue;
    nodes.add(id);
    for (const edge of control) if (edge.target === id) queue.push(edge.source);
  }
  const edges = new Set(
    control
      .filter((edge) => nodes.has(edge.source) && nodes.has(edge.target))
      .map((edge) => edge.id),
  );
  const entry =
    view.behaviors?.find((item) => item.symbolId === functionId)?.entryId ??
    view.nodes.find((node) => node.parentId === functionId && node.kind === 'entry')?.id;
  return {
    nodes,
    edges,
    partial:
      !entry ||
      !nodes.has(entry) ||
      view.nodes.some((node) => nodes.has(node.id) && node.kind === 'boundary'),
  };
}

export function canEnterCall(node: ViewNode): boolean {
  return (
    node.kind === 'call' && !!node.relatedSymbolId && node.details?.call?.dispatch === 'direct'
  );
}

export function explorationDestination(frame?: NavigationFrame): string {
  if (!frame) return 'No saved exploration';
  return `${frame.focusLabel ?? frame.request.focus}${frame.focusLine ? ` · line ${frame.focusLine}` : ''}${frame.trail ? ` · step ${frame.trail.steps.length}` : ''}`;
}

// Consecutive changes to the same focus belong to one breadcrumb. Restore its last saved context.
export function explorationBreadcrumbs(
  history: NavigationFrame[],
  focus?: string,
): { frame: NavigationFrame; index: number }[] {
  const breadcrumbs: { frame: NavigationFrame; index: number }[] = [];
  for (const [index, frame] of history.entries()) {
    if (breadcrumbs.at(-1)?.frame.request.focus === frame.request.focus) breadcrumbs.pop();
    breadcrumbs.push({ frame, index });
  }
  if (breadcrumbs.at(-1)?.frame.request.focus === focus) breadcrumbs.pop();
  return breadcrumbs.slice(-7);
}

// Collapse this declaration's disclosure only. Shared neighbors can remain through other branches.
export function collapseBranch(request: GraphRequest, node: ViewNode): GraphRequest {
  const id = node.parentId ?? node.id;
  const without = <T>(values: Record<string, T> | undefined) =>
    Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => key !== id));
  return {
    ...request,
    expanded: request.expanded.filter((seed) => seed !== id),
    internals: request.internals.filter((seed) => seed !== id),
    offsets: without(request.offsets),
    groups: without(request.groups),
    regions: (request.regions ?? []).filter((region) => !region.startsWith(`${id}/behavior/`)),
    behaviorAnchors: without(request.behaviorAnchors),
    outcomeOffsets: without(request.outcomeOffsets),
  };
}

export function resetToFocus(request: GraphRequest): GraphRequest {
  return {
    ...request,
    expanded: [],
    internals: [],
    offsets: {},
    groups: {},
    regions: [],
    behaviorAnchors: {},
    outcomeOffsets: {},
  };
}

// A new behavior window can replace source operations even when flow requested it implicitly.
export function replacedOperations(previous: GraphView | undefined, next: GraphView) {
  if (!previous || previous.focus !== next.focus) return { count: 0, functions: [] as string[] };
  const open = new Set(next.behaviors?.map((behavior) => behavior.symbolId));
  const visible = new Set(next.nodes.map((node) => node.id));
  const removed = previous.nodes.filter(
    (node) =>
      node.parentId &&
      open.has(node.parentId) &&
      !['region', 'boundary'].includes(node.kind) &&
      !visible.has(node.id),
  );
  const functions = [...new Set(removed.map((node) => node.parentId!))].map(
    (id) => next.nodes.find((node) => node.id === id)?.name ?? id,
  );
  return { count: removed.length, functions };
}

export function revealRegion(request: GraphRequest, node: ViewNode): GraphRequest {
  if (!node.parentId || !node.details?.region) return request;
  return {
    ...request,
    regions:
      node.kind === 'region'
        ? [
            ...(request.regions ?? []).filter((id) => !id.startsWith(`${node.parentId}/behavior/`)),
            node.id,
          ]
        : request.regions,
    behaviorAnchors: {
      ...request.behaviorAnchors,
      [node.parentId]: node.details.region.firstNodeId,
    },
  };
}

// Pan and zoom are independent of graph extent. Initial navigation centers only the focus.
export function focusViewport(
  position: { x: number; y: number },
  width: number,
  canvas: { width: number; height: number },
): Viewport {
  const zoom = 1;
  return {
    x: canvas.width / 2 - (position.x + width / 2) * zoom,
    y: canvas.height / 2 - (position.y + 50) * zoom,
    zoom,
  };
}

// Disclosure metadata lives only as long as its expansion seed.
export function boundRequest(request: GraphRequest): GraphRequest {
  const expanded = [...new Set(request.expanded)].slice(-20);
  const internals = [...new Set(request.internals)].slice(-16);
  const seeds = new Set([request.focus, ...expanded]);
  const functions = new Set(internals);
  const keep = <T>(
    values: Record<string, T> | undefined,
    ids: Set<string>,
  ): Record<string, T> | undefined =>
    values ? Object.fromEntries(Object.entries(values).filter(([id]) => ids.has(id))) : undefined;
  const regions = (request.regions ?? [])
    .filter((id) => internals.some((functionId) => id.startsWith(`${functionId}/behavior/`)))
    .slice(-16);
  return {
    ...request,
    expanded,
    internals,
    offsets: keep(request.offsets, seeds),
    groups: keep(request.groups, seeds),
    behaviorAnchors: keep(request.behaviorAnchors, functions),
    outcomeOffsets: keep(request.outcomeOffsets, functions),
    regions,
  };
}

export interface NavigationState {
  request?: GraphRequest;
  history: NavigationFrame[];
  future: NavigationFrame[];
  trail?: FlowTrail;
  calls: CallFrame[];
  outcomeId?: string;
  continuationCallId?: string;
}

export function refreshNavigation(
  state: NavigationState,
  previousSnapshot: string | undefined,
  snapshot: string,
): NavigationState {
  if (previousSnapshot === snapshot) return state;
  return {
    request: state.request
      ? {
          ...state.request,
          offsets: {},
          regions: [],
          behaviorAnchors: {},
          outcomeOffsets: {},
        }
      : undefined,
    history: [],
    future: [],
    calls: [],
  };
}

export function flowAfterReveal(
  trail: FlowTrail | undefined,
  node: ViewNode,
): { functionId: string; nodeId?: string } | undefined {
  if (
    !trail ||
    trail.functionId !== node.parentId ||
    trail.steps.at(-1)?.nodeId !== node.id ||
    !node.details?.region
  )
    return undefined;
  return { functionId: trail.functionId, nodeId: node.details.region.firstNodeId };
}

export function currentOperation(
  trail?: FlowTrail,
  continuationCallId?: string,
): string | undefined {
  return trail?.steps.at(-1)?.nodeId ?? continuationCallId;
}

export function frameMatchesSnapshot(
  frame: NavigationFrame,
  snapshot: string | undefined,
): boolean {
  return frame.snapshot === snapshot;
}
