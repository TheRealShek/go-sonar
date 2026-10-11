import type { SourceSpan } from './shared/protocol';

export function sourceKey(span?: SourceSpan): string {
  return span ? `${span.file}:${span.line}:${span.column}:${span.endLine}:${span.endColumn}` : '';
}

// Tokenize the entire excerpt so multiline comments and raw strings retain their state.
export function highlightGo(text: string): { text: string; kind: string }[][] {
  const tokens =
    text.match(
      /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|`[^`]*(?:`|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:0[xX][\da-fA-F_]+|\d[\w.]*)\b|[^/`"'\w]+|\w+|./g,
    ) ?? [];
  const lines: { text: string; kind: string }[][] = [[]];
  for (const token of tokens) {
    const kind =
      token.startsWith('//') || token.startsWith('/*')
        ? 'comment'
        : /^[`"']/.test(token)
          ? 'string'
          : /^\d/.test(token)
            ? 'number'
            : /^(break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|true|false|nil)$/.test(
                  token,
                )
              ? 'keyword'
              : '';
    token.split('\n').forEach((part, index) => {
      if (index) lines.push([]);
      if (part) lines.at(-1)!.push({ text: part, kind });
    });
  }
  return lines;
}
