import type { GraphView, ViewNode } from './shared/protocol';
import { symbolName } from './identity';

export type DetailLevel = 1 | 2 | 3;

export const detailHeight = (level: DetailLevel) => [42, 84, 120][level - 1];

// Density changes the card, never the evidence or source identity behind it.
export function nodePresentation(node: ViewNode, view: GraphView, level: DetailLevel) {
  const facts = node.details;
  const target = view.nodes.find((candidate) => candidate.id === node.relatedSymbolId);
  let label = symbolName(node);
  if (facts?.errorReturn) label = facts.errorReturn;
  else if (facts?.region) label = `Source group · ${facts.region.nodeCount}`;
  else if (facts?.callName) label = facts.callName;
  else if (target) label = symbolName(target);
  else if (node.parentId) {
    if (['condition', 'loop'].includes(node.kind)) label = facts?.expression || node.name;
    else
      label =
        {
          entry: 'Start',
          exit: 'End',
          return: 'Return',
          boundary: 'Analysis boundary',
          operation: 'Operation',
        }[node.kind] ?? node.name;
  }
  if (node.kind === 'operation' && facts?.role === 'operation') {
    const names = [
      ...new Set(
        facts.accesses
          ?.filter((access) => ['define', 'write', 'read_write'].includes(access.kind))
          .map((access) => access.name),
      ),
    ];
    if (names.length) label = names.slice(0, 3).join(', ');
  }
  const origin = facts?.callOrigin || target?.origin || (!node.parentId ? node.origin : undefined);
  const tag =
    origin === 'project'
      ? undefined
      : origin || (facts?.call || !node.parentId ? 'unknown' : undefined);
  const description = facts?.explanation || node.documentation;
  const sourceRange = node.source.line
    ? `L${node.source.line}${node.source.endLine > node.source.line ? `–${node.source.endLine}` : ''}`
    : 'Source unavailable';
  const type = facts?.call?.signature || node.signature;
  const error = !!facts?.errorReturn;
  const width = Math.min(360, Math.max(error ? 240 : 180, label.length * 7 + (tag ? 80 : 36)));
  const height = error ? 38 : detailHeight(level);
  return {
    label,
    tag,
    description,
    sourceRange,
    type,
    error,
    width,
    height,
    deferred: facts?.role === 'defer',
    unresolved: !!facts?.call && facts.call.dispatch !== 'direct',
  };
}

// A guard's error arm uses the side lane, leaving its continuing arm readable.
export function errorDecision(node: ViewNode, view: GraphView): boolean {
  if (node.kind !== 'condition') return false;
  let edge = view.edges.find(
    (edge) => edge.source === node.id && edge.kind === 'control' && edge.label === 'true',
  );
  const visited = new Set<string>();
  while (edge && visited.size < 8) {
    const target = view.nodes.find((candidate) => candidate.id === edge!.target);
    if (!target || visited.has(target.id)) return false;
    visited.add(target.id);
    if (target.details?.errorReturn) return true;
    const next = view.edges.filter((edge) => edge.source === target.id && edge.kind === 'control');
    if (next.length !== 1 || ['condition', 'loop', 'boundary', 'region'].includes(target.kind))
      return false;
    edge = next[0];
  }
  return false;
}
