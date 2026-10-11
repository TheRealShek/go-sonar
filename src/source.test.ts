import { describe, expect, it } from 'vitest';
import { evidenceTarget, highlightGo, sourceKey } from './source';
import { sampleBackend } from './sample';
import { requestFor } from './exploration';
import { coverageLabel } from './feedback';

describe('source evidence', () => {
  it('retains operation and binding identity without depending on line coordinates or operation IDs', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const node = view.nodes.find((node) => node.details?.accesses?.length)!;
    const access = node.details!.accesses![0];
    const target = evidenceTarget(node, access.source, view);
    expect(target).toMatchObject({
      kind: 'operation',
      functionId: 'get',
      operationKind: node.kind,
      access: { name: access.name, kind: access.kind, expression: access.expression },
    });
    expect(target).not.toHaveProperty('source');
    expect(target).not.toHaveProperty('id');
    expect(evidenceTarget({ ...node, kind: 'region' }, access.source, view)).toBeUndefined();
  });

  it('preserves a grouped occurrence expression even when it is absent from the first site page', async () => {
    const view = await sampleBackend.graph(requestFor('get'));
    const edge = view.edges.find((edge) => edge.source === 'get' && edge.kind === 'calls')!;
    expect(evidenceTarget(edge, { ...edge.evidence, line: 80 }, view, 'Load(other)')).toEqual({
      kind: 'connection',
      source: edge.source,
      target: edge.target,
      relationship: edge.kind,
      expression: 'Load(other)',
    });
    // An unknown site must require an explicit choice rather than inherit the first site.
    expect(evidenceTarget(edge, { ...edge.evidence, line: 80 }, view)).toBeUndefined();
    expect(
      evidenceTarget(
        view.nodes.find((node) => node.id === 'get'),
        edge.evidence,
        view,
      ),
    ).toEqual({ kind: 'declaration', symbolId: 'get' });
  });

  it('retains the destination meaning of a behavior connection', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const edge = view.edges.find((edge) => edge.id === 'c6')!;
    const target = view.nodes.find((node) => node.id === edge.target)!;
    expect(evidenceTarget(edge, edge.evidence, view)).toMatchObject({
      kind: 'operation',
      functionId: 'get',
      connection: {
        kind: edge.kind,
        label: edge.label,
        targetKind: target.kind,
        targetExpression: target.details?.expression || target.name,
      },
    });
  });
  it('preserves multiline text and highlights Go strings, comments and keywords safely', () => {
    const text = 'func Get() {\n/* multi\nline */ return `value\n<unsafe>` // end\n}';
    const lines = highlightGo(text);
    expect(lines.map((line) => line.map((token) => token.text).join('')).join('\n')).toBe(text);
    expect(lines[0].some((token) => token.kind === 'keyword' && token.text === 'func')).toBe(true);
    expect(lines[2][0]).toEqual({ text: 'line */', kind: 'comment' });
    expect(lines[3][0]).toEqual({ text: '<unsafe>`', kind: 'string' });
    expect(lines[3].at(-1)?.kind).toBe('comment');
  });
  it('distinguishes source occurrences on the same line', () => {
    const span = { file: '/project/a.go', line: 1, column: 2, endLine: 1, endColumn: 3 };
    expect(sourceKey(span)).not.toBe(sourceKey({ ...span, column: 4 }));
  });
});

describe('analysis coverage', () => {
  it('counts failed packages once and separates scope notices from errors', () => {
    expect(coverageLabel([{ severity: 'warning', message: 'scope', packageId: '' }])).toBe(
      'Analysis scope: 1 notice',
    );
    expect(
      coverageLabel([
        { severity: 'error', message: 'first', packageId: 'p' },
        { severity: 'error', message: 'second', packageId: 'p' },
        { severity: 'error', message: 'third', packageId: 'q' },
      ]),
    ).toBe('Partial analysis: 2 package errors');
    expect(coverageLabel([{ severity: 'error', message: 'loader', packageId: '' }])).toBe(
      'Partial analysis: 1 analysis error',
    );
  });
});
