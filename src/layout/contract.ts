export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string;
  role?: string;
  position?: Point;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  kind?: string;
  label?: string;
  loopBack?: boolean;
}

export interface LayoutRequest {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface EdgeRoute {
  sections: Point[][];
  label?: Point;
}

export interface LayoutResult {
  routes: Record<string, EdgeRoute>;
  positions: Record<string, Point>;
  sizes: Record<string, { width: number; height: number }>;
}
