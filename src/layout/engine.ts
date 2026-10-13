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
        ports: node.parentId
          ? [
              {
                id: `${node.id}:in`,
                width: 0,
                height: 0,
                layoutOptions: { 'elk.port.side': 'NORTH' },
              },
              {
                id: `${node.id}:out`,
                width: 0,
                height: 0,
                layoutOptions: { 'elk.port.side': 'SOUTH' },
              },
              {
                id: `${node.id}:right`,
                width: 0,
                height: 0,
                layoutOptions: { 'elk.port.side': 'EAST' },
              },
            ]
          : undefined,
        layoutOptions: {
          'elk.portConstraints': 'FIXED_SIDE',
          'elk.padding': '[top=70,left=48,bottom=30,right=30]',
          'elk.direction': 'DOWN',
          'elk.layered.spacing.nodeNodeBetweenLayers': '35',
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
      // Compact relationship columns; behavior groups retain source-order placement.
      'elk.layered.nodePlacement.strategy': request.nodes.some((node) => node.parentId)
        ? 'BRANDES_KOEPF'
        : 'SIMPLE',
      'elk.direction':
        request.nodes.some((node) => node.parentId) &&
        request.nodes
          .filter((node) => !node.parentId)
          .every((parent) => request.nodes.some((node) => node.parentId === parent.id))
          ? 'DOWN'
          : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.edgeEdge': '16',
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      // Spread call fan-out across horizontal layers.
      'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
      'elk.layered.layering.coffmanGraham.layerBound': '3',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    },
    children,
    edges: request.edges.map((edge) => {
      const source = request.nodes.find((node) => node.id === edge.source);
      const target = request.nodes.find((node) => node.id === edge.target);
      const right =
        edge.kind !== 'control' ||
        (source?.errorDecision
          ? edge.label === 'true'
          : ['false', 'done'].includes(edge.label ?? ''));
      return {
        id: edge.id,
        sources: [source?.parentId ? `${edge.source}:${right ? 'right' : 'out'}` : edge.source],
        targets: [target?.parentId ? `${edge.target}:in` : edge.target],
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
      };
    }),
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

  const routedPositions = structuredClone(positions);
  const routedSizes = structuredClone(sizes);

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
        candidate.y = Math.max(node.position ? 0 : 70, candidate.y);
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

  const changedGeometry = request.nodes.some(
    ({ id }) =>
      positions[id].x !== routedPositions[id].x ||
      positions[id].y !== routedPositions[id].y ||
      sizes[id].width !== routedSizes[id].width ||
      sizes[id].height !== routedSizes[id].height,
  );
  return { positions, sizes, routes: changedGeometry ? {} : routes };
}
