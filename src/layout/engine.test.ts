import ELK from 'elkjs/lib/elk.bundled.js';
import { displayBounds } from './bounds';
import { focusViewport } from '../navigation';
import { describe, expect, it } from 'vitest';
import type { ELK as ElkAPI, ElkNode } from 'elkjs/lib/elk-api.js';
import { calculateLayout } from './engine';
import type { LayoutRequest, LayoutResult } from './contract';

// Deliberately put all nodes at the same new position to exercise retention and collision repair.
const elk = {
  layout: async <T extends ElkNode>(root: T) => {
    const position = <N extends ElkNode>(node: N): N => ({
      ...node,
      x: 30,
      y: 110,
      children: node.children?.map(position),
    });
    return position(root);
  },
} as Pick<ElkAPI, 'layout'>;
const node = (id: string, extra: Partial<LayoutRequest['nodes'][number]> = {}) => ({
  id,
  width: 220,
  height: 88,
  ...extra,
});

describe('landmarks during disclosure', () => {
  it('keeps existing nodes stationary and places new nodes around them', async () => {
    const result = await calculateLayout(
      {
        nodes: [
          node('new'),
          node('left', { position: { x: 100, y: 100 } }),
          node('right', { position: { x: 450, y: 100 } }),
        ],
        edges: [],
      },
      elk,
    );
    expect(result.positions.left).toEqual({ x: 100, y: 100 });
    expect(result.positions.right).toEqual({ x: 450, y: 100 });
    expect(result.positions.new.x).toBeGreaterThanOrEqual(750);
  });
  it('anchors the selected operation and its parent when a sibling group grows', async () => {
    const result = await calculateLayout(
      {
        anchorId: 'operation',
        nodes: [
          node('other', { position: { x: 0, y: 0 } }),
          node('focus', { position: { x: 300, y: 0 } }),
          node('operation', { parentId: 'focus', position: { x: 40, y: 60 } }),
          node('expanded', {
            parentId: 'other',
            width: 700,
            height: 700,
            position: { x: 30, y: 110 },
          }),
          node('new', { parentId: 'focus' }),
        ],
        edges: [],
      },
      elk,
    );
    expect(result.positions.focus).toEqual({ x: 300, y: 0 });
    expect(result.positions.operation).toEqual({ x: 40, y: 60 });
    expect(result.positions.other.x).toBeGreaterThanOrEqual(
      result.positions.focus.x + result.sizes.focus.width + 80,
    );
    expect(result.positions.new.y).toBeGreaterThanOrEqual(193);
    expect(result.sizes.focus.height).toBeGreaterThanOrEqual(result.positions.new.y + 118);
  });
  it('separates a bounded set of colliding siblings and contains them in their group', async () => {
    const children = Array.from({ length: 25 }, (_, index) =>
      node(`child${index}`, { parentId: 'focus' }),
    );
    const result = await calculateLayout({ nodes: [node('focus'), ...children], edges: [] }, elk);
    for (const [index, child] of children.entries()) {
      expect(result.positions[child.id].x).toBeGreaterThanOrEqual(30);
      expect(result.positions[child.id].y).toBeGreaterThanOrEqual(110);
      expect(result.positions[child.id].y + child.height + 30).toBeLessThanOrEqual(
        result.sizes.focus.height,
      );
      for (const other of children.slice(index + 1))
        expect(
          Math.abs(result.positions[child.id].y - result.positions[other.id].y),
        ).toBeGreaterThanOrEqual(100);
    }
  });
});

function checkGeometry(request: LayoutRequest, result: LayoutResult) {
  for (const node of request.nodes) {
    const at = result.positions[node.id];
    const size = result.sizes[node.id];
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
    if (node.parentId) {
      const parent = result.sizes[node.parentId];
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + size.width).toBeLessThanOrEqual(parent.width);
      expect(at.y + size.height).toBeLessThanOrEqual(parent.height);
    }
    for (const other of request.nodes) {
      if (other.id === node.id || other.parentId !== node.parentId) continue;
      const next = result.positions[other.id];
      const nextSize = result.sizes[other.id];
      expect(
        at.x + size.width <= next.x ||
          next.x + nextSize.width <= at.x ||
          at.y + size.height <= next.y ||
          next.y + nextSize.height <= at.y,
      ).toBe(true);
    }
  }
}

it.each(['outgoing', 'incoming'])(
  'uses horizontal space for eight %s neighbors without overlapping nodes',
  async (direction) => {
    const request: LayoutRequest = {
      nodes: Array.from({ length: 9 }, (_, i) => ({ id: String(i), width: 220, height: 88 })),
      edges: Array.from({ length: 8 }, (_, i) => ({
        id: `edge-${i}`,
        source: direction === 'outgoing' ? '0' : String(i + 1),
        target: direction === 'outgoing' ? String(i + 1) : '0',
        kind: 'calls',
      })),
    };
    const result = await calculateLayout(request, new ELK());
    const bounds = displayBounds(
      request.nodes.map((n) => ({ ...n, position: result.positions[n.id] })),
    )!;
    expect(bounds.width).toBeGreaterThan(bounds.height * 1.5);
    expect(bounds.height).toBeLessThan(800);
    expect(
      new Set(request.nodes.slice(1).map((n) => result.positions[n.id].x)).size,
    ).toBeGreaterThan(1);
    checkGeometry(request, result);
    expect(Object.keys(result.routes)).toHaveLength(request.edges.length);
    checkRoutes(request, result);
  },
);

it('keeps shared targets, cycles, and nested control nodes valid after repeated layout', async () => {
  const request: LayoutRequest = {
    nodes: [
      { id: 'focus', width: 650, height: 450 },
      { id: 'shared', width: 220, height: 88 },
      { id: 'caller', width: 220, height: 88 },
      { id: 'entry', parentId: 'focus', width: 220, height: 88 },
      { id: 'return', parentId: 'focus', width: 220, height: 88 },
    ],
    edges: [
      { id: 'control', source: 'entry', target: 'return', kind: 'control' },
      { id: 'call', source: 'focus', target: 'shared', kind: 'calls' },
      { id: 'shared-call', source: 'caller', target: 'shared', kind: 'calls' },
      { id: 'cycle', source: 'shared', target: 'focus', kind: 'calls' },
      { id: 'internal-call', source: 'entry', target: 'shared', kind: 'calls' },
    ],
  };
  const first = await calculateLayout(request, new ELK());
  checkGeometry(request, first);
  checkRoutes(request, first);
  const second = await calculateLayout(
    {
      ...request,
      nodes: request.nodes.map((n) => ({
        ...n,
        ...first.sizes[n.id],
        position: first.positions[n.id],
      })),
    },
    new ELK(),
  );
  checkGeometry(request, second);
  checkRoutes(request, second);
  expect(second.positions).toEqual(first.positions);
});

// Every horizontal or vertical route segment must avoid unrelated leaf interiors.
function checkRoutes(request: LayoutRequest, result: LayoutResult) {
  const absolute = (id: string): { x: number; y: number } => {
    const node = request.nodes.find((node) => node.id === id)!;
    const at = result.positions[id];
    const parent = node.parentId ? absolute(node.parentId) : { x: 0, y: 0 };
    return { x: at.x + parent.x, y: at.y + parent.y };
  };
  for (const edge of request.edges) {
    const route = result.routes[edge.id];
    if (!route) continue;
    expect(route.sections.length).toBeGreaterThan(0);
    for (const points of route.sections) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const node of request.nodes) {
          if (
            node.id === edge.source ||
            node.id === edge.target ||
            request.nodes.some((child) => child.parentId === node.id)
          )
            continue;
          const at = absolute(node.id);
          const size = result.sizes[node.id];
          const crosses =
            a.x === b.x
              ? a.x > at.x + 0.1 &&
                a.x < at.x + size.width - 0.1 &&
                Math.max(a.y, b.y) > at.y + 0.1 &&
                Math.min(a.y, b.y) < at.y + size.height - 0.1
              : a.y > at.y + 0.1 &&
                a.y < at.y + size.height - 0.1 &&
                Math.max(a.x, b.x) > at.x + 0.1 &&
                Math.min(a.x, b.x) < at.x + size.width - 0.1;
          expect(crosses, `${edge.id} crosses ${node.id}`).toBe(false);
        }
      }
    }
  }
}

it('preserves manual positions and discards routes calculated for different geometry', async () => {
  const result = await calculateLayout(
    {
      nodes: [
        { id: 'a', width: 220, height: 88, position: { x: 400, y: 400 } },
        { id: 'b', width: 220, height: 88, position: { x: 20, y: 20 } },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
    },
    new ELK(),
  );
  expect(result.positions.a).toEqual({ x: 400, y: 400 });
  expect(result.positions.b).toEqual({ x: 20, y: 20 });
  expect(result.routes).toEqual({});
});

it('fits a production-sized uneven call fan-out in the available canvas without a vertical staircase', async () => {
  const ids = [
    'main',
    'run',
    'Background',
    'Error',
    'New',
    'NewJSONHandler',
    'SetDefault',
    'Exit',
    'NotifyContext',
  ];
  const request: LayoutRequest = {
    nodes: ids.map((id) => ({ id, width: 220, height: 112 })),
    edges: ids
      .slice(1)
      .map((id) => ({ id: `main-${id}`, source: 'main', target: id, kind: 'calls' })),
  };
  const result = await calculateLayout(request, new ELK());
  const bounds = displayBounds(
    request.nodes.map((node) => ({ ...node, position: result.positions[node.id] })),
  )!;
  expect(bounds.height).toBeLessThan(600);
  expect(bounds.width).toBeGreaterThan(bounds.height * 2);
  const canvas = { width: 1230, height: 590 };
  const viewport = focusViewport(result.positions.main, 220, canvas, bounds);
  expect(viewport.zoom).toBeGreaterThanOrEqual(0.8);
  expect(viewport.y + bounds.y * viewport.zoom).toBeGreaterThanOrEqual(0);
  expect(viewport.y + (bounds.y + bounds.height) * viewport.zoom).toBeLessThanOrEqual(
    canvas.height,
  );
  expect(Object.keys(result.routes)).toHaveLength(request.edges.length);
  checkGeometry(request, result);
  checkRoutes(request, result);
});
