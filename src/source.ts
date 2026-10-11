import type { EvidenceTarget, GraphView, SourceSpan, ViewEdge, ViewNode } from './shared/protocol';

export function sourceKey(span?: SourceSpan): string {
  return span ? `${span.file}:${span.line}:${span.column}:${span.endLine}:${span.endColumn}` : '';
}

// IDs inside a function change when operations are inserted. Retain meaning, not coordinates.
export function evidenceTarget(
  item: ViewNode | ViewEdge | undefined,
  span: SourceSpan,
  view?: GraphView,
  occurrenceExpression?: string,
): EvidenceTarget | undefined {
  if (!item) return;
  const node = 'name' in item ? item : view?.nodes.find((node) => node.id === item.source);
  if (node?.parentId) {
    if (node.kind === 'region' || node.kind === 'boundary') return;
    const access = node.details?.accesses?.find(
      (access) => sourceKey(access.source) === sourceKey(span),
    );
    const target =
      'evidence' in item ? view?.nodes.find((node) => node.id === item.target) : undefined;
    return {
      kind: 'operation',
      functionId: node.parentId,
      operationKind: node.kind,
      expression: node.details?.expression || node.name,
      access: access && { name: access.name, kind: access.kind, expression: access.expression },
      connection:
        'evidence' in item
          ? {
              kind: item.kind,
              label: item.label,
              ...(target?.parentId
                ? {
                    targetKind: target.kind,
                    targetExpression: target.details?.expression || target.name,
                  }
                : { targetSymbolId: item.target }),
            }
          : undefined,
    };
  }
  if ('name' in item) return { kind: 'declaration', symbolId: item.id };
  const expression =
    occurrenceExpression ??
    item.sites?.find((site) => sourceKey(site.evidence) === sourceKey(span))?.expression ??
    (sourceKey(span) === sourceKey(item.evidence) ? item.expression : undefined);
  if (!expression) return;
  return {
    kind: 'connection',
    source: item.source,
    target: item.target,
    relationship: item.kind,
    expression,
  };
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
