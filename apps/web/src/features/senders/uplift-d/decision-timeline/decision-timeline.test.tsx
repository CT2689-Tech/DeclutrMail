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

  it('renders the current item node filled (background = primary)', () => {
    const filled = renderToStaticMarkup(
      <DecisionTimeline items={[{ id: '1', when: 'today', current: true, what: 'x' }]} />,
    );
    // Filled node: background uses the primary token; SSR renders the
    // inline style attribute verbatim. Tokens are var() references
    // since the dark-mode pass — assert the token, not a hex.
    expect(filled).toContain('background:var(--dm-primary)');
  });

  it('renders non-current items outlined (background = card)', () => {
    const outlined = renderToStaticMarkup(
      <DecisionTimeline items={[{ id: '1', when: '3w ago', what: 'x' }]} />,
    );
    expect(outlined).toContain('background:var(--dm-card)');
  });

  it('renders a connector line for all items except the last', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline
        items={[
          { id: '1', when: 'today', what: 'a' },
          { id: '2', when: 'yesterday', what: 'b' },
          { id: '3', when: '3w ago', what: 'c' },
        ]}
      />,
    );
    // The connector is the absolutely-positioned spacer span with
    // left:92px. Count its occurrences — should equal items.length - 1.
    const matches = html.match(/left:92px/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('renders no connector for a single-item timeline', () => {
    const html = renderToStaticMarkup(
      <DecisionTimeline items={[{ id: '1', when: 'today', what: 'x' }]} />,
    );
    expect(html).not.toContain('left:92px');
  });
});
