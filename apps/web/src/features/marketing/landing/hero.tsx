import { ACTION_PREVIEW_CLAIM, OAUTH_SCOPE_DISCLOSURE, PrivacyBadge } from '@declutrmail/shared';
import { VERB_REGISTRY } from '@declutrmail/shared/actions';

import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * Hero (D250 locked headline — reverses D223; decision record in
 * docs/execution/packaging-2026-08-02.md and the spec's DECISIONS
 * LOCKED block) + animated ledger card (D135 adapted) + trust strip
 * (D138 reverbed by D228 — PrivacyBadge copy only).
 *
 * Copy contracts (do not edit casually):
 *   - The kicker carries NO privacy claim — its job is recognition in
 *     the buyer's own language. Privacy lives in the generated
 *     PrivacyBadge below; never paraphrase it upward.
 *   - The H1 must stay true for a FREE user (the CTA signs up Free) —
 *     "rules find it for you" claims are Plus-only and live in the
 *     subhead with the tier named.
 *
 * Server component: the demo loop is pure CSS (8s keyframes in
 * landing.css). Base styles are frame 0, so the global
 * `prefers-reduced-motion` override in tokens.css collapses the loop
 * to its informative completed state.
 */
export function Hero() {
  return (
    <>
      <section className="dm-mkt-hero">
        <div>
          <p className="dm-mkt-hero-kicker dm-mkt-reveal">
            For inboxes you <b>gave up on</b>
          </p>
          <h1 className="dm-mkt-h1 dm-mkt-reveal">
            Clear thousands of emails by <em>sender</em> — and see exactly what moves.
          </h1>
          <p className="dm-mkt-hero-sub dm-mkt-reveal-2 dm-mkt-reveal">
            One decision per sender clears thousands of emails at once — you see the count and the
            exact Gmail changes first. On Plus, rules find the matches for you; you still approve
            every batch.
          </p>
          <div className="dm-mkt-hero-ctas dm-mkt-reveal-3 dm-mkt-reveal">
            <TrackedCta
              href={oauthStartUrl()}
              cta="connect_gmail"
              placement="hero"
              className="dm-mkt-cta dm-mkt-cta-primary"
            >
              Review my Gmail senders
              <span className="dm-mkt-cta-arrow" aria-hidden="true">
                →
              </span>
            </TrackedCta>
            <TrackedCta
              href="/inbox-simulator"
              cta="try_demo"
              placement="hero"
              className="dm-mkt-cta dm-mkt-cta-ghost"
            >
              Try the demo — no sign-in
            </TrackedCta>
          </div>
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
            Free · no card · 7-day undo on Archive, Later and Delete
          </p>
          {/* Connect CTAs link straight to Google's consent screen, so the
              scope + boundary ride with the click (see OAUTH_SCOPE_DISCLOSURE). */}
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">{OAUTH_SCOPE_DISCLOSURE}</p>
        </div>
        <div className="dm-mkt-reveal-3 dm-mkt-reveal">
          <LedgerCard />
          <p className="dm-mkt-ledger-caption">
            one Archive decision · 412 emails · undoable for 7 days
          </p>
        </div>
      </section>

      <TrustStrip />
    </>
  );
}

/**
 * The D135 preview card: a sender row meets the five verbs, Archive
 * fires, the undo toast lands. Verb labels + shortcuts come from the
 * canonical registry (D227/ADR-0019) — no hand-rolled verb strings.
 */
function LedgerCard() {
  return (
    <div
      className="dm-mkt-ledger"
      role="img"
      aria-label="Demo: archiving LinkedIn Notifications. 412 messages leave Inbox, remain searchable in All Mail, affect existing mail only, and can be undone in Activity."
    >
      <div className="dm-mkt-ledger-head">
        <span>
          <span className="dm-mkt-ledger-dot" aria-hidden="true" />
          Sender review — decision 1 of 14
        </span>
        <span>this week</span>
      </div>
      <div className="dm-mkt-ledger-body">
        <div className="dm-mkt-ledger-row">
          <div className="dm-mkt-ledger-sender">
            <span className="dm-mkt-ledger-avatar" aria-hidden="true">
              in
            </span>
            <span>
              <span className="dm-mkt-ledger-name">LinkedIn Notifications</span>
              <div className="dm-mkt-ledger-meta">47/mo · 0 opened in 90 days</div>
            </span>
          </div>
          <div className="dm-mkt-ledger-verbs">
            {VERB_REGISTRY.map((verb) => (
              <span
                key={verb.id}
                className={`dm-mkt-ledger-verb${
                  verb.id === 'archive' ? ' dm-mkt-ledger-verb-archive' : ''
                }`}
              >
                <kbd>{verb.shortcut}</kbd>
                {verb.label}
              </span>
            ))}
          </div>
          <div className="dm-mkt-ledger-preview">
            <b>Preview</b>
            <span>412 messages → All Mail</span>
            <span>Existing mail only · Undo in Activity</span>
          </div>
        </div>
        <div className="dm-mkt-ledger-receipt" aria-hidden="true">
          <span className="dm-mkt-ledger-receipt-mark">✓</span>
          <b>412 messages archived from Inbox</b>
          <span>Still searchable in All Mail · existing mail only</span>
        </div>
      </div>
      <div className="dm-mkt-ledger-toast">
        <span>
          <b>Archived — LinkedIn Notifications</b> · 412 messages
        </span>
        <span className="dm-mkt-undo">Undo in Activity</span>
      </div>
    </div>
  );
}

/**
 * Trust strip (D134 §2). The privacy claim is EXCLUSIVELY the shared
 * PrivacyBadge (D228 locked copy via packages/shared/src/copy/privacy.ts).
 */
function TrustStrip() {
  return (
    <div className="dm-mkt-trust">
      {/* The chip matches the marketing surface token, so it re-resolves
          with `.dm-mkt`'s dark block (landing.css) rather than pinning a
          light background under a badge whose own palette already flips. */}
      <span style={{ background: 'var(--mkt-bg)', borderRadius: 8, display: 'inline-flex' }}>
        <PrivacyBadge variant="inline" />
      </span>
      <span className="dm-mkt-trust-item">30-day money-back guarantee</span>
      <span className="dm-mkt-trust-item" title={ACTION_PREVIEW_CLAIM}>
        Live current-scope preview before manual mail moves
      </span>
    </div>
  );
}
