import { describe, it, expect } from 'vitest';
import { nodePresentation } from './nodePresentation';
import type { GraphView, ViewNode } from './shared/protocol';

const node: ViewNode = {
  id: 'site',
  name: 'value, err := client.Load(ctx)',
  kind: 'call',
  qualifiedName: 'example::run',
  packageId: 'example',
  source: { file: 'run.go', line: 8, column: 1, endLine: 8, endColumn: 30 },
  signature: '',
  documentation: '',
  parentId: 'run',
  details: {
    role: 'call',
    expression: 'value, err := client.Load(ctx)',
    explanation: 'Load a value.',
    callName: 'client.Load',
    callOrigin: 'dependency',
    call: {
      signature: 'func(ctx context.Context) (Value, error)',
      dispatch: 'interface',
      arguments: [],
      results: [],
      variadic: false,
    },
  },
};
const view: GraphView = {
  snapshot: 'v1',
  focus: 'run',
  nodes: [node],
  edges: [],
  summaries: [],
  truncated: false,
};
describe('compact source presentation', () => {
  it('keeps callable name, exceptional origin and uncertainty at every density', () => {
    for (const level of [1, 2, 3] as const) {
      const card = nodePresentation(node, view, level);
      expect(card.label).toBe('client.Load');
      expect(card.tag).toBe('dependency');
      expect(card.unresolved).toBe(true);
      expect(card.type).toBe(node.details!.call!.signature);
      expect(card.description).toBe('Load a value.');
    }
  });
  it('never infers standard-library origin from an import-like name', () => {
    const card = nodePresentation(
      { ...node, details: { ...node.details!, callOrigin: undefined, callName: 'net.Listen' } },
      view,
      1,
    );
    expect(card.tag).toBe('unknown');
  });
  it('retains individual return identities while displaying their analyzed wrapping messages', () => {
    const first = {
      ...node,
      id: 'return-1',
      kind: 'return',
      details: {
        role: 'return',
        expression: 'return fmt.Errorf("load: %w", err)',
        explanation: 'Return error.',
        errorReturn: 'load: %w',
      },
    };
    const second = { ...first, id: 'return-2' };
    for (const site of [first, second]) {
      const card = nodePresentation(site, view, 1);
      expect(card.error).toBe(true);
      expect(card.label).toBe('load: %w');
    }
    expect(first.id).not.toBe(second.id);
    expect(
      nodePresentation({ ...first, details: { ...first.details, errorReturn: undefined } }, view, 1)
        .error,
    ).toBe(false);
  });
  it('represents defer as registration and uses analyzed region child counts', () => {
    expect(
      nodePresentation({ ...node, details: { ...node.details!, role: 'defer' } }, view, 1).deferred,
    ).toBe(true);
    expect(
      nodePresentation(
        {
          ...node,
          kind: 'region',
          details: {
            role: 'region',
            expression: '',
            explanation: 'Source group.',
            region: { firstNodeId: 'first', nodeCount: 7, calls: 4, operations: 3 },
          },
        },
        view,
        1,
      ).label,
    ).toBe('Source group · 7');
  });
});
