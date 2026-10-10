import { describe, expect, it } from 'vitest';
import { sampleBackend } from './sample';
import { requestFor } from './exploration';
import {
  boundRequest,
  refreshNavigation,
  flowAfterReveal,
  currentOperation,
  frameMatchesSnapshot,
  canEnterCall,
  followEdge,
  focusViewport,
  operationViewport,
  MAX_FLOW_STEPS,
  outcomePaths,
  revealRegion,
  successors,
  type FlowTrail,
  type NavigationState,
  type CallFrame,
} from './navigation';
import type { ViewNode } from './shared/protocol';

async function behavior() {
  return sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
}

describe('static path navigation', () => {
  it('keeps cache-hit and error-return routes separate from the mutation', async () => {
    const view = await behavior();
    let trail: FlowTrail = { functionId: 'get', steps: [{ nodeId: 'entry' }] };
    for (const edge of ['c1', 'c2', 'c3']) trail = followEdge(view, trail, edge);
    expect(trail.steps.at(-1)?.nodeId).toBe('cached');
    expect(trail.steps.at(-1)).toMatchObject({ condition: 'ok', branch: 'true' });
    expect(trail.steps.some((step) => step.nodeId === 'fetch' || step.nodeId === 'store')).toBe(
      false,
    );
    const error = outcomePaths(view, 'get', 'failure');
    expect(error.nodes.has('fetch')).toBe(true);
    expect(error.nodes.has('store')).toBe(false);
    expect(error.partial).toBe(false);
    const result = outcomePaths(view, 'get', 'result');
    expect(result.nodes.has('normalizing')).toBe(true);
    expect(result.nodes.has('store')).toBe(true);
    expect(result.nodes.has('cached')).toBe(false);
  });
  it('only steps an immediate control successor and bounds repeated traversal', async () => {
    const view = await behavior();
    const trail: FlowTrail = { functionId: 'get', steps: [{ nodeId: 'entry' }] };
    expect(followEdge(view, trail, 'c8')).toBe(trail);
    expect(successors(view, 'entry').map((edge) => edge.id)).toEqual(['c1']);
    const bounded = {
      ...trail,
      steps: Array.from({ length: MAX_FLOW_STEPS }, () => ({ nodeId: 'entry' })),
    };
    expect(followEdge(view, bounded, 'c1')).toBe(bounded);
  });
  it('blocks interface and dynamic implementation guesses', async () => {
    const view = await behavior();
    const call = view.nodes.find((node) => node.id === 'normalizing')!;
    expect(canEnterCall(call)).toBe(true);
    expect(
      canEnterCall({
        ...call,
        details: { ...call.details!, call: { ...call.details!.call!, dispatch: 'interface' } },
      }),
    ).toBe(false);
    expect(canEnterCall({ ...call, relatedSymbolId: undefined })).toBe(false);
  });
  it('reveals an exact structural region without losing surrounding expansions', () => {
    const request = {
      ...requestFor('get'),
      internals: ['get'],
      expanded: ['normalize'],
      regions: ['get/behavior/previous', 'normalize/behavior/other'],
    };
    const node = {
      id: 'get/behavior/region',
      kind: 'region',
      parentId: 'get',
      details: { region: { firstNodeId: 'first', nodeCount: 8, calls: 3, operations: 5 } },
    } as ViewNode;
    const next = revealRegion(request, node);
    expect(next.regions).toEqual(['normalize/behavior/other', 'get/behavior/region']);
    expect(next.behaviorAnchors).toEqual({ get: 'first' });
    expect(next.internals).toEqual(['get']);
    expect(next.expanded).toEqual(['normalize']);
  });
  it('prunes stale disclosure metadata before another request', () => {
    const functions = Array.from({ length: 30 }, (_, i) => `fn${i}`);
    const entries = Object.fromEntries(functions.map((id) => [id, 40]));
    const anchors = Object.fromEntries(functions.map((id) => [id, `${id}/behavior/entry`]));
    const request = boundRequest({
      ...requestFor('fn29'),
      expanded: functions,
      internals: functions,
      offsets: entries,
      outcomeOffsets: entries,
      behaviorAnchors: anchors,
      groups: Object.fromEntries(
        functions.map((id) => [
          id,
          { kind: 'calls', packageId: 'pkg', direction: 'outgoing' as const },
        ]),
      ),
      regions: functions.map((id) => `${id}/behavior/region`),
    });
    expect(request.expanded).toHaveLength(20);
    expect(request.internals).toHaveLength(16);
    expect(Object.keys(request.behaviorAnchors!)).toEqual(functions.slice(-16));
    expect(Object.keys(request.outcomeOffsets!)).toEqual(functions.slice(-16));
    expect(Object.keys(request.groups!)).toEqual(functions.slice(-20));
    expect(Object.keys(request.offsets!)).toEqual(functions.slice(-20));
    expect(request.regions).toEqual(functions.slice(-16).map((id) => `${id}/behavior/region`));
  });
  it('reports incomplete outcome paths when the entry is outside the view', async () => {
    const view = await behavior();
    expect(
      outcomePaths(
        {
          ...view,
          nodes: view.nodes.filter((node) => node.id !== 'entry'),
          edges: view.edges.filter((edge) => edge.source !== 'entry'),
        },
        'get',
        'result',
      ).partial,
    ).toBe(true);
  });
});

describe('walkthrough viewport', () => {
  const canvas = { width: 800, height: 600 };
  const viewport = { x: 20, y: -30, zoom: 0.5 };
  it('keeps zoom and pan when the whole operation is comfortably visible', () => {
    expect(operationViewport(viewport, { x: 200, y: 250, width: 220, height: 88 }, canvas)).toEqual(
      viewport,
    );
  });
  it.each([
    { x: -100, y: 250, expectedX: 130, expectedY: -30 },
    { x: 1400, y: 250, expectedX: -90, expectedY: -30 },
    { x: 200, y: 0, expectedX: 20, expectedY: 80 },
    { x: 200, y: 1200, expectedX: 20, expectedY: -124 },
  ])(
    'pans only the necessary axis for an operation at $x, $y',
    ({ x, y, expectedX, expectedY }) => {
      expect(operationViewport(viewport, { x, y, width: 220, height: 88 }, canvas)).toEqual({
        x: expectedX,
        y: expectedY,
        zoom: 0.5,
      });
    },
  );
  it('centers on request while keeping the chosen zoom', () => {
    expect(
      operationViewport(viewport, { x: 200, y: 250, width: 220, height: 88 }, canvas, true),
    ).toEqual({ x: 245, y: 153, zoom: 0.5 });
  });
  it('centers an oversized operation without zooming out', () => {
    expect(
      operationViewport({ x: 0, y: 0, zoom: 2 }, { x: 0, y: 0, width: 500, height: 400 }, canvas),
    ).toEqual({ x: -100, y: -100, zoom: 2 });
  });
});

describe('readable exploration defaults', () => {
  it('starts with eight outgoing targets and preserves explicit preferences', () => {
    expect(requestFor('get')).toMatchObject({
      kinds: ['calls'],
      direction: 'outgoing',
      neighborLimit: 8,
      internals: [],
    });
    expect(requestFor('cache', 'field')).toMatchObject({
      kinds: ['reads', 'writes'],
      direction: 'incoming',
    });
    expect(requestFor('item', 'struct').kinds).toContain('constructs');
    expect(
      requestFor('next', 'function', {
        kinds: ['writes'],
        direction: 'incoming',
        neighborLimit: 6,
      }),
    ).toMatchObject({ kinds: ['writes'], direction: 'incoming', neighborLimit: 6 });
  });
  it('centers the focus at a readable zoom independently of fan-out bounds', () => {
    expect(focusViewport({ x: 1000, y: 500 }, 220, { width: 800, height: 600 })).toEqual({
      x: -710,
      y: -250,
      zoom: 1,
    });
  });
  it('summarizes repeated calls while retaining their evidence sites', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), direction: 'incoming' });
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0].siteCount).toBe(2);
    expect(view.edges[0].sites?.map((site) => site.evidence.line)).toEqual([26, 27]);
  });
});

describe('navigation across disclosure, calls, and snapshots', () => {
  const trail: FlowTrail = { functionId: 'get', steps: [{ nodeId: 'entry' }] };
  const region = {
    id: 'get/behavior/region',
    parentId: 'get',
    kind: 'region',
    details: { region: { firstNodeId: 'later' } },
  } as ViewNode;
  it('does not teleport a followed entry when an unrelated region is disclosed', () => {
    expect(flowAfterReveal(trail, region)).toBeUndefined();
    expect(
      flowAfterReveal({ ...trail, functionId: 'other', steps: [{ nodeId: region.id }] }, region),
    ).toBeUndefined();
    expect(flowAfterReveal({ ...trail, steps: [{ nodeId: region.id }] }, region)).toEqual({
      functionId: 'get',
      nodeId: 'later',
    });
  });
  it('keeps the graph highlight aligned with the walkthrough after returning from another call', async () => {
    const view = await behavior();
    const id = currentOperation(trail, 'normalizing');
    expect(id).toBe('entry');
    expect(successors(view, id!).map((e) => e.target)).toEqual(['lookup']);
    expect(currentOperation(undefined, 'normalizing')).toBe('normalizing');
    expect(currentOperation(trail)).toBe('entry');
  });
  it('rejects saved frames after the same occurrence ID is reused in a new snapshot', () => {
    const frame = { snapshot: 'before', request: requestFor('get'), selectedId: 'reused-id' };
    expect(frameMatchesSnapshot(frame, 'after')).toBe(false);
    expect(frameMatchesSnapshot(frame, undefined)).toBe(false);
    expect(frameMatchesSnapshot(frame, 'before')).toBe(true);
  });
  it('invalidates operation identities and saved navigation on a changed snapshot', () => {
    const request = {
      ...requestFor('get'),
      internals: ['get'],
      regions: [region.id],
      behaviorAnchors: { get: 'reused-id' },
      outcomeOffsets: { get: 30 },
      offsets: { get: 8 },
    };
    const frame: CallFrame = {
      snapshot: 'before',
      request,
      trail,
      callId: 'reused-id',
      targetId: 'normalize',
      expression: 'second()',
      sourceLine: 4,
      continuationIds: ['next'],
      viewport: { x: 20, y: 30, zoom: 1 },
    };
    const state: NavigationState = {
      request,
      history: [frame],
      future: [frame],
      calls: [frame],
      trail,
      outcomeId: 'return-id',
      continuationCallId: 'reused-id',
    };
    // New analysis can assign reused-id to first(); no old occurrence state may survive it.
    const changed = refreshNavigation(state, 'before', 'after');
    expect(changed.history).toEqual([]);
    expect(changed.future).toEqual([]);
    expect(changed.calls).toEqual([]);
    expect(changed.trail).toBeUndefined();
    expect(changed.outcomeId).toBeUndefined();
    expect(changed.continuationCallId).toBeUndefined();
    expect(changed.request).toMatchObject({
      focus: 'get',
      internals: ['get'],
      regions: [],
      behaviorAnchors: {},
      outcomeOffsets: {},
      offsets: {},
    });
    expect(refreshNavigation(state, 'before', 'before')).toBe(state);
  });
});
