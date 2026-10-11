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
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '45',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    },
    children,
    edges: request.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
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

  // Place known landmarks first, with the selected node and its parent taking priority.
  // New nodes move around those landmarks. Grow groups to contain retained child positions.
  const byId = new Map(request.nodes.map((node) => [node.id, node]));
  const anchors = new Set<string>();
  let anchor = request.anchorId ? byId.get(request.anchorId) : undefined;
  while (anchor && !anchors.has(anchor.id)) {
    anchors.add(anchor.id);
    anchor = anchor.parentId ? byId.get(anchor.parentId) : undefined;
  }
  const siblings = new Map<string | undefined, typeof request.nodes>();
  for (const node of request.nodes) {
    const group = siblings.get(node.parentId) ?? [];
    group.push(node);
    siblings.set(node.parentId, group);
  }
  const place = (parentId?: string) => {
    const group = [...(siblings.get(parentId) ?? [])];
    for (const node of group) if (siblings.has(node.id)) place(node.id);
    group.sort(
      (a, b) =>
        Number(anchors.has(b.id)) - Number(anchors.has(a.id)) ||
        Number(!!b.position) - Number(!!a.position),
    );
    const placed: string[] = [];
    for (const node of group) {
      const candidate = { ...(node.position ?? positions[node.id]) };
      const size = sizes[node.id];
      if (parentId) {
        candidate.x = Math.max(node.position ? 0 : 30, candidate.x);
        candidate.y = Math.max(node.position ? 0 : 110, candidate.y);
      }
      // Every move passes a colliding sibling, so this loop is bounded by the placed nodes.
      for (let attempt = 0; attempt < placed.length; attempt++) {
        const collision = placed.find((id) => {
          const at = positions[id];
          const other = sizes[id];
          return (
            candidate.x < at.x + other.width + 12 &&
            candidate.x + size.width + 12 > at.x &&
            candidate.y < at.y + other.height + 12 &&
            candidate.y + size.height + 12 > at.y
          );
        });
        if (!collision) break;
        if (parentId) candidate.y = positions[collision].y + sizes[collision].height + 45;
        else candidate.x = positions[collision].x + sizes[collision].width + 80;
      }
      positions[node.id] = candidate;
      placed.push(node.id);
      if (parentId) {
        sizes[parentId].width = Math.max(sizes[parentId].width, candidate.x + size.width + 30);
        sizes[parentId].height = Math.max(sizes[parentId].height, candidate.y + size.height + 30);
      }
    }
  };
  place();

  return { positions, sizes };
}
