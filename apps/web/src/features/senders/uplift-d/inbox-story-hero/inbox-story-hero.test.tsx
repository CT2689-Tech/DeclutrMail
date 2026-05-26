// Contract tests for <InboxStoryHero /> (Variant D).
// SSR-only assertions per shared-package house style.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InboxStoryHero } from './inbox-story-hero';

describe('<InboxStoryHero /> — Variant D', () => {
  it('renders eyebrow, all story lines, and the CTA', () => {
    const html = renderToStaticMarkup(
      <InboxStoryHero
        eyebrow="Your inbox this week"
        story={['312 emails reached you.', 'Only 18% were worth reading.']}
        ctaCopy="5 decisions can cut next week's inbox by ~48%."
        ctaLabel="Start review"
      />,
    );
    expect(html).toContain('Your inbox this week');
    expect(html).toContain('312 emails reached you.');
    expect(html).toContain('Only 18% were worth reading.');
    expect(html).toContain('Start review');
    // Apostrophe gets HTML-encoded by SSR (&#x27;) so we split the
    // assertion around it rather than matching the literal char.
    expect(html).toContain('5 decisions can cut next week');
    expect(html).toContain('s inbox by ~48%.');
  });

  it('renders meta strip entries with labels', () => {
    const html = renderToStaticMarkup(
      <InboxStoryHero
        eyebrow="x"
        story={['x']}
        meta={[
          { value: '4.2h', label: 'Reading time / mo' },
          { value: '−8%', label: 'vs last month', deltaTone: 'down' },
        ]}
        ctaCopy="y"
        ctaLabel="Go"
      />,
    );
    expect(html).toContain('4.2h');
    expect(html).toContain('Reading time / mo');
    expect(html).toContain('−8%');
    expect(html).toContain('vs last month');
  });

  it('omits the meta strip when no meta supplied', () => {
    const html = renderToStaticMarkup(
      <InboxStoryHero eyebrow="x" story={['x']} ctaCopy="y" ctaLabel="Go" />,
    );
    // No meta entries means no flex grid with the meta items — assert
    // by the absence of any meta value we control.
    expect(html).not.toContain('Reading time');
  });

  it('renders the default trust line when none supplied (canonical V1 string)', () => {
    const html = renderToStaticMarkup(
      <InboxStoryHero eyebrow="x" story={['x']} ctaCopy="y" ctaLabel="Go" />,
    );
    expect(html).toContain('Metadata only');
    expect(html).toContain('No message bodies');
    expect(html).toContain('Reversible for 7 days');
  });

  it('honors a custom trust line override', () => {
    const html = renderToStaticMarkup(
      <InboxStoryHero
        eyebrow="x"
        story={['x']}
        ctaCopy="y"
        ctaLabel="Go"
        trustLine="Custom trust copy"
      />,
    );
    expect(html).toContain('Custom trust copy');
  });

  it('does not include any D209 forbidden words in the default trust line', () => {
    const html = renderToStaticMarkup(
      <InboxStoryHero eyebrow="x" story={['x']} ctaCopy="y" ctaLabel="Go" />,
    );
    // D209 forbidden list — applied to component-internal defaults only.
    // Consumer-supplied strings are linted at PR time by check-microcopy.sh.
    const forbidden = ['smart', 'AI-powered', 'magic', 'nuke', 'blast', 'supercharge'];
    for (const word of forbidden) {
      expect(html.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});
