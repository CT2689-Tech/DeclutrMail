import { PrivacyBadge } from '@declutrmail/shared';

import { oauthStartUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * D134 §10 — final CTA + footer.
 *
 * Footer links include /privacy /terms /refunds — those routes ship in
 * the sibling legal unit and may 404 until it merges (expected,
 * noted in the PR).
 */

export function FinalCta() {
  return (
    <section className="dm-mkt-final dm-mkt-shell">
      <p className="dm-mkt-eyebrow" style={{ justifyContent: 'center' }}>
        Last step
      </p>
      <h2 className="dm-mkt-h2">Your inbox is a few hundred decisions away.</h2>
      <div className="dm-mkt-hero-ctas" style={{ justifyContent: 'center' }}>
        <TrackedCta
          href={oauthStartUrl()}
          cta="connect_gmail"
          placement="final"
          className="dm-mkt-cta dm-mkt-cta-primary"
        >
          Connect your Gmail
          <span className="dm-mkt-cta-arrow" aria-hidden="true">
            →
          </span>
        </TrackedCta>
      </div>
      <p className="dm-mkt-hero-note">Free tier · no card · every action reversible</p>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="dm-mkt-footer">
      <div className="dm-mkt-shell">
        <div className="dm-mkt-footer-row">
          <nav className="dm-mkt-footer-links" aria-label="Legal">
            <a href="/pricing">Pricing</a>
            <a href="/help">Help</a>
            <a href="/contact">Contact</a>
            <a href="/security">Security</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/refunds">Refunds</a>
          </nav>
          <span style={{ background: '#fafaf7', borderRadius: 8, display: 'inline-flex' }}>
            <PrivacyBadge variant="inline" />
          </span>
        </div>
        <p className="dm-mkt-footer-fine">
          © {new Date().getFullYear()} DeclutrMail · Works with Gmail. Not affiliated with or
          endorsed by Google.
        </p>
      </div>
    </footer>
  );
}
