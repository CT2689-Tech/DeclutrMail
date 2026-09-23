import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { HeroWorkspace } from './hero-workspace';
import { ScopeDisclosure } from './scope-disclosure';
import { permissionEntryUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * The chosen editorial stage: a clear promise and the sender workspace
 * visible immediately, with the OAuth disclosure beside the sign-up CTA.
 *
 * The muted line keeps the Free cap beside "No credit card" on purpose
 * (QA-sign-in-05): "free" with no limit stated read as unlimited. The
 * number comes from the tier manifest, never a literal.
 */
export function Hero() {
  return (
    <section className="dm-mkt-hero dm-mkt-shell" aria-labelledby="dm-home-hero-title">
      <div className="dm-mkt-hero-copy">
        <p className="dm-mkt-hero-kicker">A CLEARER WAY THROUGH GMAIL</p>
        <h1 id="dm-home-hero-title" className="dm-mkt-h1">
          Clear Gmail clutter. <em>See what moves first.</em>
        </h1>
        <p className="dm-mkt-hero-sub">
          Review years of mail by sender. See the matching count and planned Gmail change before you
          confirm a move. Gmail stays where you read and reply.
        </p>
        <div className="dm-mkt-hero-ctas">
          <TrackedCta
            href={permissionEntryUrl()}
            cta="connect_gmail"
            placement="hero"
            className="dm-mkt-cta dm-mkt-cta-primary"
          >
            Start free
          </TrackedCta>
          <TrackedCta
            href="/inbox-simulator?workspace=senders"
            cta="try_demo"
            placement="hero"
            className="dm-mkt-cta-link"
          >
            Explore the demo
          </TrackedCta>
        </div>
        <p className="dm-mkt-hero-note">
          Free to begin · {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month · No
          credit card.
        </p>
        {/* "Start free" opens the permission checkpoint; the
            pre-consent disclosure sits beside it (copy contract in
            packages/shared/src/copy/privacy.ts) — collapsed to one line. */}
        <div className="dm-mkt-hero-note">
          <ScopeDisclosure />
        </div>
      </div>
      <div className="dm-mkt-hero-visual">
        <div className="dm-mkt-hero-stage-label">
          THE PRODUCT, UP CLOSE <span>↘</span>
        </div>
        <HeroWorkspace />
      </div>
    </section>
  );
}
