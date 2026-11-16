import { WS3_COPY } from '@declutrmail/shared/copy/launch';

import { ScopeDisclosure } from './scope-disclosure';
import { permissionEntryUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * D134 §10 — the final CTA. "Start free" opens the permission checkpoint,
 * which carries the scope disclosure in full; the collapsed copy here is
 * the page's one pre-consent disclosure beside a sign-up action.
 */
export function FinalCta() {
  return (
    <section className="dm-home-final dm-mkt-shell" aria-labelledby="dm-home-final-title">
      <div className="dm-home-final-card">
        <h2 id="dm-home-final-title" className="dm-home-h2">
          Start with <em>one sender.</em>
        </h2>
        <div className="dm-home-final-actions">
          <div className="dm-mkt-hero-ctas">
            <TrackedCta
              href={permissionEntryUrl()}
              cta="connect_gmail"
              placement="final"
              className="dm-mkt-cta dm-home-final-primary"
            >
              Start free
            </TrackedCta>
            <TrackedCta
              href="/inbox-simulator?workspace=senders"
              cta="try_demo"
              placement="final"
              className="dm-home-final-link"
            >
              {WS3_COPY['ws3.home.cta.demo']} <span aria-hidden="true">→</span>
            </TrackedCta>
          </div>
          <ScopeDisclosure />
        </div>
      </div>
    </section>
  );
}
