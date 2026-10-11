import { describe, expect, it } from 'vitest';
import { highlightGo, sourceKey } from './source';
import { coverageLabel } from './feedback';

describe('source evidence', () => {
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
