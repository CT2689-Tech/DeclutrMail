import { ScopeDisclosure } from './scope-disclosure';
import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * D134 §10 — final CTA + footer.
 */

export function FinalCta() {
  return (
    <section className="dm-mkt-final dm-mkt-shell">
      <p className="dm-mkt-eyebrow" style={{ justifyContent: 'center' }}>
        Your first step
      </p>
      <h2 className="dm-mkt-h2">Start with one sender.</h2>
      <p className="dm-mkt-final-sub">
        Find the clutter, preview the cleanup, and make your first decision. You stay in control.
      </p>
      <div className="dm-mkt-hero-ctas" style={{ justifyContent: 'center' }}>
        <TrackedCta
          href={oauthStartUrl()}
          cta="connect_gmail"
          placement="final"
          className="dm-mkt-cta dm-mkt-cta-primary"
        >
          Start cleaning for free
          <span className="dm-mkt-cta-arrow" aria-hidden="true">
            →
          </span>
        </TrackedCta>
      </div>
      <p className="dm-mkt-hero-note">Free tier · no card · preview before email moves</p>
      <div className="dm-mkt-hero-note dm-mkt-scope-center">
        <ScopeDisclosure />
      </div>
    </section>
  );
}
