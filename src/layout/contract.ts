export interface Point {
  x: number;
  y: number;
}
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string;
  position?: Point;
}
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}
export interface LayoutRequest {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}
export interface LayoutResult {
  positions: Record<string, Point>;
  sizes: Record<string, { width: number; height: number }>;
}
