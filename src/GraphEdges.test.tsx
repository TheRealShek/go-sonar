import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { edgeLabel, GraphLegend, selectionConnections, graphEmphasis } from './GraphEdges';
import { outcomePaths } from './navigation';
import { sampleBackend } from './sample';
import { requestFor } from './exploration';

describe('relationship presentation', () => {
  it('keeps the entire return route emphasized when the return node is also selected', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const returned = view.nodes.find(
      (node) => node.kind === 'return' && node.name.includes('item'),
    )!;
    const selection = selectionConnections(view, returned.id);
    const route = outcomePaths(view, 'get', returned.id);
    const earlier = [...route.edges].find((id) => !selection.edges.has(id))!;
    expect(earlier).toBeTruthy();
    expect(graphEmphasis(selection, route).edges.has(earlier)).toBe(true);
    expect(graphEmphasis(selection).edges.has(earlier)).toBe(false);
    expect(graphEmphasis(selection, route).endpoints.has('entry')).toBe(true);
  });
  it('distinguishes uncertainty, loops, and repeated source occurrences', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const edge = view.edges[0];
    expect(edgeLabel({ ...edge, kind: 'calls', certainty: 'possible', siteCount: 5 })).toBe(
      '? possible · calls · 5 source sites',
    );
    expect(
      edgeLabel({ ...edge, kind: 'control', label: 'continue', loopBack: true, siteCount: 1 }),
    ).toBe('continue · ↺ loop back');
    const html = renderToStaticMarkup(
      <GraphLegend
        view={{
          ...view,
          edges: [
            { ...edge, kind: 'control', loopBack: true },
            { ...edge, kind: 'calls', certainty: 'possible', siteCount: 5 },
          ],
        }}
      />,
    );
    expect(html).toContain('Flow graph legend');
    expect(html).toContain('? possible · unresolved');
    expect(html).toContain('solid return route');
    expect(html).toContain('repeated source occurrences');
    expect(
      renderToStaticMarkup(<GraphLegend view={{ ...view, behaviors: [], edges: [] }} />),
    ).toContain('Relationship graph legend');
  });
  it('emphasizes only the selected connection or all connections incident on a selected node', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const selected = view.edges.find((edge) => edge.id === 'c6')!;
    const single = selectionConnections(view, selected.id);
    expect([...single.edges]).toEqual(['c6']);
    expect([...single.endpoints]).toEqual([selected.source, selected.target]);
    const adjacent = selectionConnections(view, 'error');
    expect([...adjacent.edges]).toEqual(['c5', 'c6', 'c7']);
    expect(adjacent.endpoints.has('store')).toBe(false);
    expect(selectionConnections(undefined, 'error').edges.size).toBe(0);
    expect(selectionConnections(view).endpoints.size).toBe(0);
  });
});
