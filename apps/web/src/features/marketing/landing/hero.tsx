import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { InboxCollapse } from './inbox-collapse';
import { ScopeDisclosure } from './scope-disclosure';
import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * One idea: the headline, one button, one quiet link, one muted line, the
 * collapsed OAuth disclosure — and beside it, the product doing the one
 * thing it does (an inbox collapsing into senders, then a confirm card).
 *
 * The muted line keeps the Free cap beside "No credit card" on purpose
 * (QA-sign-in-05): "free" with no limit stated read as unlimited. The
 * number comes from the tier manifest, never a literal.
 */
export function Hero() {
  return (
    <section className="dm-mkt-hero dm-mkt-shell">
      <div className="dm-mkt-hero-copy">
        <h1 className="dm-mkt-h1">Clear years of clutter, one sender at a time.</h1>
        <p className="dm-mkt-hero-sub">
          Review your Gmail by sender. Preview which emails will move, then decide what stays.
        </p>
        <div className="dm-mkt-hero-ctas">
          <TrackedCta
            href={oauthStartUrl()}
            cta="connect_gmail"
            placement="hero"
            className="dm-mkt-cta dm-mkt-cta-primary"
          >
            Start free
          </TrackedCta>
          <TrackedCta
            href="/inbox-simulator"
            cta="try_demo"
            placement="hero"
            className="dm-mkt-cta-link"
          >
            Try the demo
          </TrackedCta>
        </div>
        <p className="dm-mkt-hero-note">
          {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month, free. No credit card.
        </p>
        {/* "Start free" goes straight to Google's consent screen, so the
            pre-consent disclosure sits beside it (copy contract in
            packages/shared/src/copy/privacy.ts) — collapsed to one line. */}
        <div className="dm-mkt-hero-note">
          <ScopeDisclosure />
        </div>
      </div>
      <div className="dm-mkt-hero-visual">
        <InboxCollapse />
      </div>
    </section>
  );
}
