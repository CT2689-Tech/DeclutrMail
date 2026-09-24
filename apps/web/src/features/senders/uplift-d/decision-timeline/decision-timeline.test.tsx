// Contract tests for <DecisionTimeline /> (Variant D).
// SSR-only assertions per shared-package house style.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionTimeline } from './decision-timeline';

describe('<DecisionTimeline /> — Variant D', () => {
  it('renders heading when provided', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline
        heading="Decision timeline"
        items={[{ id: '1', when: 'today', what: 'x' }]}
      />,
    );
    expect(html).toContain('Decision timeline');
  });

  it('omits heading when not provided', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline items={[{ id: '1', when: 'today', what: 'x' }]} />,
    );
    expect(html).not.toContain('Decision timeline');
  });

  it('renders the empty slot instead of a bare rail when nothing happened', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline
        heading="Decision timeline"
        items={[]}
        empty={<p>No actions on this sender yet</p>}
      />,
    );
    expect(html).toContain('No actions on this sender yet');
  });

  it('hides the empty slot as soon as there is a real action to show', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline
        items={[{ id: '1', when: 'today', what: 'You Kept' }]}
        empty={<p>No actions on this sender yet</p>}
      />,
    );
    expect(html).not.toContain('No actions on this sender yet');
    expect(html).toContain('You Kept');
  });

  it('renders each item with its when label and what body', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline
        items={[
          { id: '1', when: 'today', current: true, what: 'Engine recommends Unsubscribe' },
          { id: '2', when: '3w ago', what: 'You chose Keep' },
        ]}
      />,
    );
    expect(html).toContain('today');
    expect(html).toContain('Engine recommends Unsubscribe');
    expect(html).toContain('3w ago');
    expect(html).toContain('You chose Keep');
  });

  it('marks only the current item with the teal dot', () => {
    const current = renderToStaticMarkup(
      <DecisionTimeline items={[{ id: '1', when: 'today', current: true, what: 'x' }]} />,
    );
    // Tokens are var() references since the dark-mode pass.
    expect(current).toContain('background:var(--dm-primary)');
    expect(current).toContain('data-current="true"');
    const past = renderToStaticMarkup(
      <DecisionTimeline items={[{ id: '1', when: '3w ago', what: 'x' }]} />,
    );
    expect(past).not.toContain('background:var(--dm-primary)');
  });

  it('separates items with a hairline — none above the first', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline
        items={[
          { id: '1', when: 'today', what: 'a' },
          { id: '2', when: 'yesterday', what: 'b' },
          { id: '3', when: '3w ago', what: 'c' },
        ]}
      />,
    );
    expect(html.match(/border-top:1px solid var\(--dm-line-soft\)/g) ?? []).toHaveLength(2);
  });
});
