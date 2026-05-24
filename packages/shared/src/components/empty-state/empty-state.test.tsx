// Contract tests for the promoted `<EmptyState />` primitive (D212).
//
// D212 makes empty states first-class. The component is the canonical
// pattern every list/queue/index uses; if it stops rendering the title,
// stops accepting a description, or stops gating the tier nudge on
// `tier='free'`, downstream features regress silently.
//
// Rendering is SSR-only (per the shared-package house style) so the
// suite stays decoupled from jsdom/happy-dom.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './empty-state';

describe('<EmptyState /> — D212 primitive', () => {
  it('renders the title verbatim', () => {
    const html = renderToStaticMarkup(<EmptyState title="No senders yet" />);
    expect(html).toContain('No senders yet');
  });

  it('renders the description when supplied via the new `description` prop', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No senders yet" description="DeclutrMail is watching for new patterns." />,
    );
    expect(html).toContain('DeclutrMail is watching for new patterns.');
  });

  it('renders the description when supplied via the legacy `body` alias', () => {
    // Backwards compatibility — pre-D212 senders/sender-detail call
    // sites still pass `body`. Removing this alias would force a
    // cross-feature rewrite that the parallel agent is responsible for.
    const html = renderToStaticMarkup(
      <EmptyState title="No decisions yet" body="Decide once and remember." />,
    );
    expect(html).toContain('Decide once and remember.');
  });

  it('prefers `description` over `body` when both are supplied', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No decisions yet" description="Preferred copy" body="Legacy copy" />,
    );
    expect(html).toContain('Preferred copy');
    expect(html).not.toContain('Legacy copy');
  });

  it('renders the action node when supplied', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="Sender not found"
        action={<button type="button">Back to Senders</button>}
      />,
    );
    expect(html).toContain('Back to Senders');
  });

  it('renders the tier nudge only when tier=free AND tierNudge is set', () => {
    // Plus tier never sees the nudge — even if a nudge object is passed.
    const plusHtml = renderToStaticMarkup(
      <EmptyState
        title="You cleared today's queue."
        tier="plus"
        tierNudge={{
          headline: 'You are out of free decisions today.',
          body: 'Plus removes the daily cap.',
        }}
      />,
    );
    expect(plusHtml).not.toContain('You are out of free decisions today.');

    const freeHtml = renderToStaticMarkup(
      <EmptyState
        title="You cleared today's queue."
        tier="free"
        tierNudge={{
          headline: 'You are out of free decisions today.',
          body: 'Plus removes the daily cap.',
        }}
      />,
    );
    expect(freeHtml).toContain('You are out of free decisions today.');
    expect(freeHtml).toContain('Plus removes the daily cap.');
  });

  it('never renders the nudge for tier=pro (Pro is already past the cap)', () => {
    // Pro is the topmost paid tier — a Plus-targeted upgrade nudge would
    // be a UX regression (we'd be asking a Pro user to upgrade to Plus).
    // Lock the gating so a future refactor of `showNudge` can't widen
    // it past `tier === 'free'`.
    const proHtml = renderToStaticMarkup(
      <EmptyState
        title="You cleared today's queue."
        tier="pro"
        tierNudge={{
          headline: 'You are out of free decisions today.',
          body: 'Plus removes the daily cap.',
        }}
      />,
    );
    expect(proHtml).not.toContain('You are out of free decisions today.');
    expect(proHtml).not.toContain('Plus removes the daily cap.');
  });

  it('does not render the nudge when tier=free but tierNudge is omitted', () => {
    const html = renderToStaticMarkup(<EmptyState title="No rules yet" tier="free" />);
    // The nudge surface uses the primaryWash; if no nudge is supplied,
    // no nudge container should render. Asserting on the headline copy
    // is sufficient — there is no nudge copy to find.
    expect(html).not.toContain('Plus removes');
  });

  it('renders the icon when supplied', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No messages" icon={<span data-test="icon">★</span>} />,
    );
    expect(html).toContain('★');
  });

  it('uses a dashed border so it never looks like an error state (D212)', () => {
    // Error boundaries use solid borders in red/amber; empty states use
    // a dashed border in the neutral border colour. Lock the dashed
    // treatment here so a future style refactor cannot collapse the
    // visual distinction.
    const html = renderToStaticMarkup(<EmptyState title="No senders yet" />);
    expect(html).toContain('border:1px dashed');
  });
});
