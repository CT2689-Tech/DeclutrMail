import {
  ACTION_PREVIEW_CLAIM,
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
  OAUTH_SCOPE_DISCLOSURE,
  PrivacyBadge,
} from '@declutrmail/shared';
import { VERB_REGISTRY } from '@declutrmail/shared/actions';

import { LedgerDemo } from './ledger-demo';
import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';
import { MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

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
 * The hero stays a Server Component. Its small `LedgerDemo` client
 * island owns pause/replay state around the CSS timeline; the global
 * `prefers-reduced-motion` override collapses that timeline to its
 * informative completed state.
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
            exact Gmail changes first. On Plus, turn on a rule and it keeps doing it, only after
            showing you what it would do.
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
            Free · no card · {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month ·{' '}
            {MIN_UNDO_WINDOW_DAYS}-day undo on Archive, Later and Delete
          </p>
          {/* Connect CTAs link straight to Google's consent screen, so the
              permission explanation stays beside the click. */}
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">{OAUTH_SCOPE_DISCLOSURE}</p>
        </div>
        <div className="dm-mkt-reveal-3 dm-mkt-reveal">
          <LedgerDemo
            verbs={VERB_REGISTRY.map(({ id, label, shortcut }) => ({ id, label, shortcut }))}
          />
        </div>
      </section>

      <TrustStrip />
    </>
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
        See which emails will move before you confirm
      </span>
      {/* D138's third trust item, restored. The wording may not exceed
          what /security#verification already states — Google APPROVED
          our OAuth verification for one restricted scope; it is not a
          certification of the product, so never "certified"/"audited".
          The date comes from shared copy, like the two claims above it:
          verification recertifies annually, so a hand-copied date is one
          that goes stale on a schedule. */}
      <a
        className="dm-mkt-trust-item"
        href="/security#verification"
        title={`Google approved DeclutrMail's OAuth verification on ${CASA_VERIFICATION_APPROVED_ON} for the single restricted scope we request, gmail.modify.`}
      >
        Google OAuth verification approved, {CASA_VERIFICATION_APPROVED_MONTH} (CASA Tier 2)
      </a>
    </div>
  );
}
