import { ScopeDisclosure } from './scope-disclosure';
import { permissionEntryUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * D134 §10 — the final CTA. The sign-in decision is made here, so this is
 * where the page's single OAuth scope disclosure sits (collapsed).
 */
export function FinalCta() {
  return (
    <section className="dm-mkt-final dm-mkt-shell">
      <h2 className="dm-mkt-h2">Start with one sender.</h2>
      <div className="dm-mkt-hero-ctas">
        <TrackedCta
          href={permissionEntryUrl()}
          cta="connect_gmail"
          placement="final"
          className="dm-mkt-cta dm-mkt-cta-primary"
        >
          Start free
        </TrackedCta>
      </div>
      <div className="dm-mkt-hero-note">
        <ScopeDisclosure />
      </div>
    </section>
  );
}
