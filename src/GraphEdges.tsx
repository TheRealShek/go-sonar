import { BaseEdge, getBezierPath, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { EdgeRoute, Point } from './layout/contract';

const connectionColors = ['#81a1c1', '#88c0d0', '#a3be8c', '#b48ead', '#ebcb8b', '#d5967a'];

export function connectionColor(id: string, kind: string, label: string) {
  if (kind === 'data') return '#b48ead';
  if (kind === 'control') {
    if (['false', 'done'].includes(label)) return '#d5967a';
    if (['true', 'iterate', 'next item'].includes(label)) return '#a3be8c';
    return '#88c0d0';
  }
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return connectionColors[hash % connectionColors.length];
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
