import { useMemo, useState, useRef, useEffect } from 'react';
import { ReactFlow, MarkerType, type ReactFlowInstance } from '@xyflow/react';
import type { CallFrame } from './navigation';
import { nodeTypes, IdentityCard, type SymbolNode } from './GraphCards';
import { edgeTypes, edgeLabel, connectionColor } from './GraphEdges';
import {
  nodePresentation,
  errorDecision,
  detailHeight,
  type DetailLevel,
} from './nodePresentation';
import type { ViewNode } from './shared/protocol';

// Render only the immediate saved caller. Deeper frames remain in bounded history.
export function CallerPane({
  frame,
  level,
  busy,
  onReturn,
  onInspect,
}: {
  frame: CallFrame;
  level: DetailLevel;
  busy: boolean;
  onReturn: () => void;
  onInspect: (node: ViewNode) => void;
}) {
  const [hovered, setHovered] = useState<ViewNode>();
  const [pinned, setPinned] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<SymbolNode> | null>(null);
  const previousLevel = useRef(level);
  const suppressFocus = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const cancelDismiss = () => clearTimeout(hoverTimer.current);
  const dismissLater = () => {
    if (!pinned) hoverTimer.current = setTimeout(() => setHovered(undefined), 180);
  };
  const dismissCard = () => {
    cancelDismiss();
    const id = hovered?.id;
    setHovered(undefined);
    setPinned(false);
    suppressFocus.current = true;
    const node = [...(canvas.current?.querySelectorAll<HTMLElement>('[data-id]') ?? [])].find(
      (node) => node.dataset.id === id,
    );
    node?.focus();
    suppressFocus.current = false;
  };
  const view = frame.callerView!;
  useEffect(() => {
    const at = frame.positions?.[frame.callId];
    const call = view.nodes.find((node) => node.id === frame.callId);
    const parent = call?.parentId ? frame.positions?.[call.parentId] : undefined;
    const savedHeight = detailHeight(frame.callerDetailLevel ?? 1);
    const anchorY = (level: DetailLevel) =>
      (((at?.y ?? 0) + (parent?.y ?? 0)) * detailHeight(level)) / savedHeight +
      detailHeight(level) / 2;
    if (flow.current && at && previousLevel.current !== level) {
      const viewport = flow.current.getViewport();
      void flow.current.setViewport({
        ...viewport,
        y: viewport.y + (anchorY(previousLevel.current) - anchorY(level)) * viewport.zoom,
      });
    }
    previousLevel.current = level;
  }, [level, frame, view]);
  const nodes = useMemo<SymbolNode[]>(
    () =>
      view.nodes.map((node) => {
        const at = frame.positions?.[node.id];
        const rowScale = detailHeight(level) / detailHeight(frame.callerDetailLevel ?? 1);
        const presentation = nodePresentation(node, view, level);
        const grouped = view.nodes.some((child) => child.parentId === node.id);
        return {
          id: node.id,
          type: 'symbol',
          parentId: node.parentId,
          position: { x: at?.x ?? 0, y: (at?.y ?? 0) * rowScale },
          style: grouped
            ? { width: at?.width, height: at?.height ? at.height * rowScale : undefined }
            : { width: at?.width ?? presentation.width, height: presentation.height },
          selected: node.id === frame.callId,
          data: {
            ...presentation,
            errorDecision: errorDecision(node, view),
            level,
            label: presentation.label,
            kind: node.kind,
            summary: presentation.description,
            grouped,
            focused: false,
            packageId: node.packageId,
            role: node.parentId ? (node.details?.role ?? node.kind) : undefined,
          },
        };
      }),
    [frame, view, level],
  );
  const edges = useMemo(
    () =>
      view.edges
        .filter(
          (edge) =>
            nodes.some((node) => node.id === edge.source) &&
            nodes.some((node) => node.id === edge.target),
        )
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'routed',
          data: { rounded: true },
          label:
            edge.kind === 'control' && ['', 'source order', 'return'].includes(edge.label)
              ? undefined
              : edgeLabel(edge),
          sourceHandle: ['true', 'iterate', 'next item'].includes(edge.label)
            ? 'branch-true'
            : ['false', 'done'].includes(edge.label)
              ? 'branch-false'
              : undefined,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: connectionColor(edge.id, edge.kind, edge.label),
          },
          style: {
            stroke: connectionColor(edge.id, edge.kind, edge.label),
            strokeDasharray: edge.certainty === 'possible' ? '6 4' : undefined,
          },
          labelStyle: { fill: 'var(--foreground)', fontSize: 11 },
          labelBgStyle: { fill: 'var(--panel)' },
        })),
    [view, nodes],
  );
  return (
    <section
      className="caller-pane"
      aria-label="Saved caller flow"
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && hovered) {
          event.preventDefault();
          event.stopPropagation();
          dismissCard();
        }
      }}
    >
      <div className="caller-heading">
        <span>Caller</span>
        <button disabled={busy} onClick={onReturn}>
          ← Return
        </button>
      </div>
      <code>
        {view.nodes.find((node) => node.id === frame.request.focus)?.signature || frame.focusLabel}
      </code>
      <p className="call-site">
        Call at line {frame.sourceLine}: {frame.expression}
      </p>
      <span className="call-connection">Call relationship → callee</span>
      <div
        className="caller-canvas"
        ref={canvas}
        onFocusCapture={(event) => {
          if (suppressFocus.current) return;
          const id = (event.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id');
          const node = view.nodes.find((node) => node.id === id);
          if (node) {
            cancelDismiss();
            setHovered(node);
          }
        }}
        onKeyDownCapture={(event) => {
          if (
            event.key === 'Enter' &&
            hovered &&
            !(event.target as HTMLElement).closest('button')
          ) {
            event.preventDefault();
            onInspect(hovered);
          }
        }}
      >
        <ReactFlow<SymbolNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => {
            flow.current = instance;
            const at = frame.positions?.[frame.callId];
            const call = view.nodes.find((node) => node.id === frame.callId);
            const parent = call?.parentId ? frame.positions?.[call.parentId] : undefined;
            const bounds = canvas.current?.getBoundingClientRect();
            if (at && bounds)
              void instance.setViewport({
                x: bounds.width / 2 - (at.x + (parent?.x ?? 0) + at.width / 2),
                y:
                  bounds.height / 2 -
                  (((at.y + (parent?.y ?? 0)) * detailHeight(level)) /
                    detailHeight(frame.callerDetailLevel ?? 1) +
                    detailHeight(level) / 2),
                zoom: 1,
              });
          }}
          minZoom={0.3}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          colorMode="light"
          onNodeMouseEnter={(_, node) => {
            cancelDismiss();
            if (!pinned) setHovered(view.nodes.find((fact) => fact.id === node.id));
          }}
          onNodeMouseLeave={dismissLater}
          onNodeClick={(_, node) => {
            const fact = view.nodes.find((fact) => fact.id === node.id);
            if (fact) onInspect(fact);
          }}
          onNodeDoubleClick={(_, node) => {
            const fact = view.nodes.find((fact) => fact.id === node.id);
            if (fact) onInspect(fact);
          }}
        />
      </div>
      {hovered && (
        <div onMouseEnter={cancelDismiss} onMouseLeave={dismissLater}>
          <IdentityCard
            value={hovered}
            nodes={view.nodes}
            pinned={pinned}
            onPin={() => setPinned(!pinned)}
            onDismiss={dismissCard}
            onInspect={() => onInspect(hovered)}
          />
        </div>
      )}
    </section>
  );
}
