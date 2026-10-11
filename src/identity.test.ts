import { describe, expect, it } from 'vitest';
import { symbolName, compactPackage, operationName, nodeName } from './identity';
import type { ViewNode } from './shared/protocol';

describe('readable declaration identity', () => {
  const method = {
    name: 'Get',
    kind: 'method',
    packageId: 'example.org/project/cache',
    qualifiedName: 'example.org/project/cache::*example.org/project/cache.Cache.Get',
  };
  it('distinguishes receiver methods and retains generic receiver identity', () => {
    expect(symbolName(method)).toBe('Cache.Get');
    expect(
      symbolName({
        ...method,
        qualifiedName: method.qualifiedName.replace('Cache.Get', 'Repository.Get'),
      }),
    ).toBe('Repository.Get');
    expect(
      symbolName({
        ...method,
        qualifiedName: method.qualifiedName.replace('Cache.Get', 'Cache[T].Get'),
      }),
    ).toBe('Cache[T].Get');
    expect(symbolName({ ...method, qualifiedName: 'cache.Cache.Get' })).toBe('Cache.Get');
  });
  it('does not invent receivers for incomplete facts or non-methods', () => {
    expect(symbolName({ ...method, qualifiedName: 'cache.Get' })).toBe('Get');
    expect(symbolName({ ...method, kind: 'function' })).toBe('Get');
    expect(compactPackage(method.packageId)).toBe('project/cache');
    expect(compactPackage('builtin')).toBe('builtin');
  });
  it('uses source expressions for operations and handles missing projected endpoints', () => {
    const node = { ...method, id: 'method' } as ViewNode;
    expect(operationName(node)).toBe('Cache.Get');
    expect(
      operationName({
        ...node,
        details: { role: 'call', explanation: 'Call', expression: 'cache.Get(key)' },
      }),
    ).toBe('cache.Get(key)');
    expect(nodeName([node], 'method')).toBe('Cache.Get');
    expect(nodeName([node], 'hidden', 'Hidden target')).toBe('Hidden target');
  });
});
