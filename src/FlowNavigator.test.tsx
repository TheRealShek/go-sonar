import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowNavigator } from './FlowNavigator';
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
    expect(html).toContain('Step 2 / 120');
    expect(html).toContain('Resume walkthrough');
    expect(html).not.toContain('Pause walkthrough');
    expect(html).toContain('<button disabled="">Step backward</button>');
    expect(html).toContain('<button disabled="">next</button>');
  });
});
