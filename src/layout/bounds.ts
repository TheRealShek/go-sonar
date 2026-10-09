import type { Point } from './contract';

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
// Child coordinates are relative to their function group. Its geometry already
// contains those children, so only root rectangles define the fitted viewport.
export function displayBounds(
  nodes: { parentId?: string; position: Point; width: number; height: number }[],
): DisplayBounds | undefined {
  const roots = nodes.filter((node) => !node.parentId);
  if (!roots.length) return undefined;

  const x = Math.min(...roots.map((node) => node.position.x));
  const y = Math.min(...roots.map((node) => node.position.y));

  return {
    x,
    y,
    width: Math.max(...roots.map((node) => node.position.x + node.width)) - x,
    height: Math.max(...roots.map((node) => node.position.y + node.height)) - y,
  };
}
