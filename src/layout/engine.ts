import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';
import type { LayoutRequest, LayoutResult } from './contract';
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
        layoutOptions: { 'elk.padding': '[top=65,left=25,bottom=25,right=25]' },
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
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '45',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    },
    children,
    edges: request.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions: LayoutResult['positions'] = {},
    sizes: LayoutResult['sizes'] = {};
  const walk = (entries: ElkNode[]) => {
    for (const node of entries) {
      positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
      sizes[node.id] = { width: node.width ?? 210, height: node.height ?? 75 };
      walk(node.children ?? []);
    }
  };
  walk(output.children ?? []);
  // Retain known positions only if their group dimensions did not change; children use parent-relative coordinates.
  for (const node of request.nodes) {
    if (
      !node.position ||
      sizes[node.id].width !== node.width ||
      sizes[node.id].height !== node.height
    )
      continue;
    const candidate = node.position;
    const size = sizes[node.id];
    const parent = node.parentId ? sizes[node.parentId] : undefined;
    if (
      parent &&
      (candidate.x < 20 ||
        candidate.y < 60 ||
        candidate.x + size.width > parent.width - 20 ||
        candidate.y + size.height > parent.height - 20)
    )
      continue;
    const overlaps = request.nodes.some((other) => {
      if (other.id === node.id || other.parentId !== node.parentId) return false;
      const at = positions[other.id],
        bounds = sizes[other.id];
      return (
        candidate.x < at.x + bounds.width + 12 &&
        candidate.x + size.width + 12 > at.x &&
        candidate.y < at.y + bounds.height + 12 &&
        candidate.y + size.height + 12 > at.y
      );
    });
    if (!overlaps) positions[node.id] = candidate;
  }
  return { positions, sizes };
}
