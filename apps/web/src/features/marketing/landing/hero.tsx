import {
  ACTION_PREVIEW_CLAIM,
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
  PRIVACY_BADGE_HEADLINE,
} from '@declutrmail/shared';
import { VERB_REGISTRY } from '@declutrmail/shared/actions';

import { LedgerDemo } from './ledger-demo';
import { ScopeDisclosure } from './scope-disclosure';
import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';
import { MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

/**
 * Free-tier signup stays the primary path. Keep permission disclosure beside
 * OAuth and use shared constants for limits and privacy claims.
 * The ledger demo is the only interactive island in the server-rendered hero.
 */
export function Hero() {
  return (
    <>
      <section className="dm-mkt-hero">
        <div>
          <p className="dm-mkt-hero-kicker dm-mkt-reveal">
            A fresh start for your <b>Gmail inbox</b>
          </p>
          <h1 className="dm-mkt-h1 dm-mkt-reveal">
            Clear years of clutter. <em>One sender at a time.</em>
          </h1>
          <p className="dm-mkt-hero-sub dm-mkt-reveal-2 dm-mkt-reveal">
            Review newsletters, notifications, and promotions together by sender. Preview which
            emails will move, then decide what stays in your inbox.
          </p>
          <div className="dm-mkt-hero-ctas dm-mkt-reveal-3 dm-mkt-reveal">
            <TrackedCta
              href={oauthStartUrl()}
              cta="connect_gmail"
              placement="hero"
              className="dm-mkt-cta dm-mkt-cta-primary"
            >
              Start cleaning for free
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
            {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month, free. No credit
            card.
          </p>
          <p className="dm-mkt-hero-reassurance dm-mkt-reveal">
            <span aria-hidden="true">↶</span> Changed your mind? Undo Archive, Later, or Delete for{' '}
            {MIN_UNDO_WINDOW_DAYS} days.
          </p>
          {/* Connect CTAs link straight to Google's consent screen, so the
              permission explanation stays beside the click. */}
          <div className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
            <ScopeDisclosure />
          </div>
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
 * Trust strip (D134 §2). The privacy claim is the shared PRIVACY_BADGE_HEADLINE
 * (D228 locked copy via packages/shared/src/copy/privacy.ts), linking to the
 * full PrivacyBadge + generated storage list in PrivacyDesk (§03) rather than
 * restating the list here.
 */
function TrustStrip() {
  return (
    <div className="dm-mkt-trust">
      {/* The full generated storage list lives once on this page, in
          PrivacyDesk (§03) — linking there instead of repeating it inline
          keeps the hero's own trust claim to a single line. */}
      <a className="dm-mkt-trust-item" href="#privacy">
        {PRIVACY_BADGE_HEADLINE}
      </a>
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
