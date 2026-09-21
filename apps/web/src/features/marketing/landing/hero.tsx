import { VERB_REGISTRY } from '@declutrmail/shared/actions';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { LedgerDemo } from './ledger-demo';
import { ScopeDisclosure } from './scope-disclosure';
import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * One idea: the headline, one button, one quiet link, one muted line, and
 * the product moving underneath. Everything that used to sit under the
 * button — the undo reassurance, the trust strip, the OAuth scope
 * disclosure — lives once further down the page, at the block that owns it
 * (How it works, Privacy, and the final CTA respectively).
 *
 * The muted line keeps the Free cap beside "No credit card" on purpose
 * (QA-sign-in-05): "free" with no limit stated read as unlimited. The
 * number comes from the tier manifest, never a literal.
 */
export function Hero() {
  return (
    <section className="dm-mkt-hero dm-mkt-shell">
      <h1 className="dm-mkt-h1 dm-mkt-reveal">
        Clear years of clutter. <em>One sender at a time.</em>
      </h1>
      <p className="dm-mkt-hero-sub dm-mkt-reveal-2 dm-mkt-reveal">
        Review your Gmail by sender. Preview which emails will move, then decide what stays.
      </p>
      <div className="dm-mkt-hero-ctas dm-mkt-reveal-3 dm-mkt-reveal">
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
          Try the demo <span aria-hidden="true">→</span>
        </TrackedCta>
      </div>
      <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
        {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month, free. No credit card.
      </p>
      {/* "Start free" goes straight to Google's consent screen, so the
          pre-consent disclosure sits beside it (copy contract in
          packages/shared/src/copy/privacy.ts) — collapsed to one line. */}
      <div className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
        <ScopeDisclosure />
      </div>
      <div className="dm-mkt-hero-demo dm-mkt-reveal-4 dm-mkt-reveal">
        <LedgerDemo
          verbs={VERB_REGISTRY.map(({ id, label, shortcut }) => ({ id, label, shortcut }))}
        />
      </div>
    </section>
  );
}
