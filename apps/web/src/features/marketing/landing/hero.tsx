import { fillWs3, heroKicker, WS3_COPY } from '@declutrmail/shared/copy/launch';

import { NotOnGmail } from '../waitlist/not-on-gmail';
import { HeroPreview } from './hero-preview';
import { permissionEntryUrl } from './urls';
import { TrackedCta } from './tracked-cta';

/**
 * The promise, one primary action, and the preview a visitor would see
 * before mail moves.
 *
 * The muted line keeps the Free cap beside "No card required" on purpose
 * (QA-sign-in-05): "free" with no limit stated read as unlimited. The
 * number comes from the tier manifest, never a literal.
 *
 * The verification claim is one short line here; its full wording, dates
 * and scope sit in the Privacy section and on /security#verification,
 * which "Security details" opens. The privacy promise sits in Privacy today;
 * marketing pages may also lead with it (CLAUDE.md §8.5).
 */
export function Hero() {
  return (
    <section className="dm-mkt-hero dm-mkt-shell" aria-labelledby="dm-home-hero-title">
      <div className="dm-mkt-hero-copy">
        <p className="dm-mkt-hero-kicker">{heroKicker()}</p>
        <h1 id="dm-home-hero-title" className="dm-mkt-h1">
          Clear Gmail clutter. <em>See what moves first.</em>
        </h1>
        <p className="dm-mkt-hero-sub">{WS3_COPY['ws3.home.sub']}</p>
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
            {WS3_COPY['ws3.home.cta.demo']} <span aria-hidden="true">→</span>
          </TrackedCta>
        </div>
        <p className="dm-mkt-hero-note">{fillWs3(WS3_COPY['ws3.home.note'])}</p>
        <div className="dm-home-verified">
          <span className="dm-home-verified-claim">
            <ShieldGlyph />
            Google OAuth verified · CASA Tier 2 assessed
          </span>
          <a href="/security#verification">Security details</a>
          {/* A div, not a span: NotOnGmail renders a <details> block. */}
          <div className="dm-home-verified-gmail">
            {WS3_COPY['ws3.home.gmailOnly']} <NotOnGmail source="landing" />
          </div>
        </div>
      </div>
      <div className="dm-mkt-hero-visual">
        <HeroPreview />
      </div>
    </section>
  );
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
