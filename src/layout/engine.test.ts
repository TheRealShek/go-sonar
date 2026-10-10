import ELK from 'elkjs/lib/elk.bundled.js';
import { expect, it } from 'vitest';
import { calculateLayout } from './engine';
import { displayBounds } from './bounds';
import type { LayoutRequest, LayoutResult } from './contract';

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

it('keeps routes aligned when old manual positions differ from the new layout', async () => {
  const request: LayoutRequest = {
    nodes: [
      { id: 'a', width: 220, height: 88, position: { x: 400, y: 400 } },
      { id: 'b', width: 220, height: 88, position: { x: 20, y: 20 } },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
  };
  const result = await calculateLayout(request, new ELK());
  checkGeometry(request, result);
  checkRoutes(request, result);
  const path = result.routes.ab.sections[0];
  expect(path[0].x).toBe(result.positions.a.x + result.sizes.a.width);
  expect(path.at(-1)!.x).toBe(result.positions.b.x);
});
