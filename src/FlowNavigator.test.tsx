import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowNavigator, BranchHistory } from './FlowNavigator';
import { followEdge, MAX_FLOW_STEPS } from './navigation';
import { requestFor } from './exploration';
import { sampleBackend } from './sample';
import type { ComponentProps } from 'react';

const noop = () => {};
const actions = {
  onStart: noop,
  onStep: noop,
  onBack: noop,
  onReveal: noop,
  onOutcome: noop,
  onOutcomePage: noop,
  onReturn: noop,
  onStop: noop,
  onResume: noop,
  onPause: noop,
  onKeepStepCentered: noop,
};

async function render(updates: Partial<ComponentProps<typeof FlowNavigator>> = {}) {
  const request = { ...requestFor('get'), internals: ['get', 'normalize'] };
  const view = await sampleBackend.graph(request);
  return renderToStaticMarkup(
    <FlowNavigator
      {...actions}
      request={request}
      view={view}
      calls={[]}
      busy={false}
      keepStepCentered={false}
      {...updates}
    />,
  );
}

describe('walkthrough controls', () => {
  it('opens an overview without starting a walkthrough and offers the chosen neighbor behavior', async () => {
    const html = await render({ functionId: 'normalize' });
    expect(html).toContain('Behavior overview: Normalize');
    expect(html).toContain('Start walkthrough');
    expect(html).toContain('<code>return item</code>');
    expect(html).not.toContain('return item, nil');
    expect(html).not.toContain('flow-current');
    expect(html).not.toContain('Restart walkthrough');
  });

  it('keeps the followed function distinct from a neighboring overview and preserves explicit stop', async () => {
    const html = await render({
      functionId: 'normalize',
      trail: { functionId: 'get', steps: [{ nodeId: 'entry' }] },
    });
    expect(html).toContain('Behavior overview: Normalize');
    expect(html).toContain('Following: Input: key');
    expect(html).toContain('Start walkthrough');
    expect(html).toContain('Restart walkthrough');
    expect(html).toContain('Pause walkthrough');
    expect(html).toContain('Stop following');
  });

  it('offers resume for a paused path and disables stepping without losing progress', async () => {
    const html = await render({
      trail: {
        functionId: 'get',
        steps: [{ nodeId: 'entry' }, { nodeId: 'lookup' }],
        paused: true,
      },
    });
    expect(html).toContain('Paused: Lookup cache[key]');
    expect(html).toContain('<span>Step 2</span>');
    expect(html).not.toContain('120');
    expect(html).toContain('Resume walkthrough');
    expect(html).not.toContain('Pause walkthrough');
    expect(html).toMatch(
      /<button disabled="" title="Return to Input: key · line 7">Previous step<\/button>/,
    );
    expect(html).toContain('<button disabled="">ok</button>');
  });

  it('names the caller destination separately from a previous step', async () => {
    const html = await render({
      calls: [
        {
          snapshot: 'sample',
          request: requestFor('get'),
          focusLabel: 'Service.Get',
          focusLine: 6,
          callId: 'normalizing',
          expression: 'Normalize(item)',
          sourceLine: 16,
          targetId: 'normalize',
          continuationIds: [],
        },
      ],
    });
    expect(html).toContain('Return to Service.Get · line 6 · call at line 16: Normalize(item)');
    expect(html).toContain('Return to caller');
  });

  it('describes both branch consequences and retains them in a compact history', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const trail = { functionId: 'get', steps: [{ nodeId: 'error' }] };
    const html = await render({ trail });
    expect(html).toContain('err != nil → return Item{}, err');
    expect(html).toContain('Otherwise → Normalize(item)');
    const followed = followEdge(view, trail, 'c7');
    const history = renderToStaticMarkup(<BranchHistory trail={followed} />);
    expect(history).toContain('aria-label="Chosen conditions"');
    expect(history).toContain('Otherwise (err != nil)');
    expect(history).toContain('Normalize(item)');
  });

  it('shows the safety bound only when further stepping would exceed it', async () => {
    const html = await render({
      trail: {
        functionId: 'get',
        steps: Array.from({ length: MAX_FLOW_STEPS }, () => ({ nodeId: 'error' })),
      },
    });
    expect(html).toContain('<span>Step 120</span>');
    expect(html).toContain('Safety limit of 120 steps reached');
    expect(html).toContain('<button disabled="">Otherwise → Normalize(item)</button>');
  });
});
