import { describe, expect, it } from 'vitest';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';
import { calculateLayout } from './engine';
import type { LayoutRequest } from './contract';

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
} as Pick<ELK, 'layout'>;
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
