import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';
import type { LayoutRequest, LayoutResult, Point } from './contract';

export async function calculateLayout(
  request: LayoutRequest,
  elk: Pick<ELK, 'layout'>,
): Promise<LayoutResult> {
  const nodes = new Map<string, ElkNode>(
    request.nodes.map((node) => [
      node.id,
      {
        id: node.id,
        width: node.width,
        height: node.height,
        children: [],
        layoutOptions: {
          'elk.padding': '[top=110,left=30,bottom=30,right=30]',
          'elk.direction': 'DOWN',
          'elk.layered.spacing.nodeNodeBetweenLayers': '65',
        },
      },
    ]),
  );
  const children: ElkNode[] = [];

  for (const node of request.nodes) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (node.parentId && !parent) throw new Error('Missing layout parent');

    if (parent) parent.children!.push(nodes.get(node.id)!);
    else children.push(nodes.get(node.id)!);
  }

  const output = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.edgeEdge': '16',
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      // Limit sibling rows so fan-out uses horizontal space instead of a tall column.
      'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
      'elk.layered.layering.coffmanGraham.layerBound': '3',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    },
    children,
    edges: request.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
      labels:
        edge.kind === 'control' && edge.label
          ? [
              {
                id: `${edge.id}-label`,
                text: edge.label,
                width: edge.label.length * 7 + 12,
                height: 20,
              },
            ]
          : [],
      layoutOptions: {
        'elk.layered.priority.direction': edge.loopBack
          ? '0'
          : edge.kind === 'control'
            ? '10'
            : '1',
      },
    })),
  });
  const positions: LayoutResult['positions'] = {};
  const sizes: LayoutResult['sizes'] = {};
  const walk = (entries: ElkNode[]) => {
    for (const node of entries) {
      positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
      sizes[node.id] = { width: node.width ?? 210, height: node.height ?? 75 };
      walk(node.children ?? []);
    }
  };
  walk(output.children ?? []);

  // ELK routes and nodes must use the same coordinates. Reusing individual old
  // positions would make paths cross nodes that moved after routing.
  const routes: LayoutResult['routes'] = {};
  const offsets = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
  const locate = (node: ElkNode, parent: Point) => {
    const offset = { x: parent.x + (node.x ?? 0), y: parent.y + (node.y ?? 0) };
    offsets.set(node.id, offset);
    for (const child of node.children ?? []) locate(child, offset);
  };
  locate(output, { x: 0, y: 0 });
  const collect = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const offset = offsets.get(edge.container ?? node.id)!;
      const absolute = (point: Point): Point => ({ x: point.x + offset.x, y: point.y + offset.y });
      const sections = (edge.sections ?? []).map((section) =>
        [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(absolute),
      );
      const label = edge.labels?.[0];
      if (sections.length)
        routes[edge.id] = {
          sections,
          label: label
            ? absolute({
                x: (label.x ?? 0) + (label.width ?? 0) / 2,
                y: (label.y ?? 0) + (label.height ?? 0) / 2,
              })
            : undefined,
        };
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(output);

  return { positions, sizes, routes };
}
