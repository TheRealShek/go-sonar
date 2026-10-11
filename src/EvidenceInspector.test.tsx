import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceInspector } from './EvidenceInspector';
import { sampleBackend } from './sample';
import { requestFor } from './exploration';
import type { ComponentProps } from 'react';

vi.mock('./backend', () => ({ backend: { relationSites: vi.fn() } }));

const noop = () => {};
const actions = {
  onFocus: noop,
  onUsage: noop,
  onChange: noop,
  onEnter: noop,
  onFollow: noop,
  onReveal: noop,
  onSelect: noop,
  onSource: noop,
  onImpact: noop,
  onPage: noop,
  onShow: noop,
  onGroup: noop,
  onClearGroup: noop,
};
async function render(updates: Partial<ComponentProps<typeof EvidenceInspector>> = {}) {
  const request = { ...requestFor('get'), internals: ['get'] };
  const view = await sampleBackend.graph(request);
  const selected = view.nodes.find((node) => node.id === 'fetch')!;
  return renderToStaticMarkup(
    <EvidenceInspector
      {...actions}
      busy={false}
      impact=""
      callDepth={0}
      root="/sample"
      view={view}
      request={request}
      selected={selected}
      {...updates}
    />,
  );
}

describe('operation comprehension', () => {
  it('shows explanation, limitation, source and call entry before expandable mappings', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const node = view.nodes.find((node) => node.id === 'fetch')!;
    const html = await render({
      selected: {
        ...node,
        documentation: 'Longer usage documentation',
        details: { ...node.details!, limitation: 'Values are not tracked.' },
      },
    });
    const explanation = html.indexOf('operation-explanation');
    const limitation = html.indexOf('Values are not tracked.');
    const source = html.indexOf('Open source evidence');
    const action = html.indexOf('Enter this call');
    const mapping = html.indexOf('<summary>Arguments and returned positions</summary>');
    expect(explanation).toBeGreaterThan(-1);
    expect(limitation).toBeGreaterThan(explanation);
    expect(source).toBeGreaterThan(limitation);
    expect(action).toBeGreaterThan(source);
    expect(mapping).toBeGreaterThan(action);
    expect(html).toContain('<details class="call-boundary"><summary>');
    expect(html).toContain('<details><summary>Documentation</summary>');
    expect(html).not.toContain('call-boundary" open');
  });
  it('keeps unresolved dispatch visible outside the mapping and disables guessed call entry', async () => {
    const view = await sampleBackend.graph({ ...requestFor('get'), internals: ['get'] });
    const node = view.nodes.find((node) => node.id === 'fetch')!;
    const html = await render({
      selected: {
        ...node,
        details: { ...node.details!, call: { ...node.details!.call!, dispatch: 'interface' } },
      },
    });
    expect(html.indexOf('implementation is unresolved')).toBeLessThan(
      html.indexOf('Open source evidence'),
    );
    expect(html).not.toContain('Enter this call');
  });
});
