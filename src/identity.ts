import type { SymbolFact, ViewNode } from './shared/protocol';

export function symbolName(
  symbol: Pick<SymbolFact, 'name' | 'kind' | 'qualifiedName' | 'packageId'>,
): string {
  if (symbol.kind !== 'method') return symbol.name;
  const packageName = symbol.packageId.split('/').at(-1) ?? '';
  const qualified = symbol.qualifiedName.split('::').at(-1) ?? symbol.name;
  const local = qualified.replaceAll(`${symbol.packageId}.`, '').replace(/^\*+/, '');
  const name = local.startsWith(`${packageName}.`) ? local.slice(packageName.length + 1) : local;
  return name.endsWith(`.${symbol.name}`) ? name : symbol.name;
}

export function operationName(node: ViewNode): string {
  return node.details?.expression || symbolName(node);
}

export function compactPackage(packageId: string): string {
  return packageId.split('/').slice(-2).join('/');
}

export function nodeName(
  nodes: ViewNode[] | undefined,
  id: string | undefined,
  fallback = '',
): string {
  const node = nodes?.find((candidate) => candidate.id === id);
  return node ? operationName(node) : fallback;
}
