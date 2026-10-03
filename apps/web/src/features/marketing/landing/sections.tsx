import {
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';

/**
 * Landing body sections. All server-rendered; zero client JS.
 *
 * Each block states its idea once. The interactive journey carries Undo,
 * Privacy carries the storage boundary, and each Google sign-in CTA carries
 * the OAuth scope disclosure.
 */

/** A short bridge from the sender walkthrough to the rest of the product. */
export function ProductBreadth() {
  return (
    <section
      id="everyday-tools"
      className="dm-mkt-breadth dm-mkt-shell"
      aria-labelledby="dm-mkt-breadth-title"
    >
      <div className="dm-mkt-breadth-heading">
        <p className="dm-mkt-journey-kicker">Everyday tools</p>
        <h2 id="dm-mkt-breadth-title" className="dm-mkt-h2">
          A clearer inbox is only the beginning.
        </h2>
        <p className="dm-mkt-lede">
          DeclutrMail also helps you notice what changed, revisit conversations that may need a
          follow-up, and decide which cleanup should repeat.
        </p>
      </div>
      <div className="dm-mkt-breadth-grid">
        <article className="dm-mkt-breadth-card dm-mkt-autopilot-card">
          <span className="dm-mkt-breadth-number">AUTOPILOT · PLUS &amp; PRO</span>
          <h3>Put chosen rules to work.</h3>
          <p>
            Autopilot starts with suggestions and previews. You choose whether a rule only watches
            or takes action.
          </p>
          <div className="dm-mkt-breadth-visual" aria-hidden="true">
            <span>RULE PREVIEW</span>
            <strong>Review before it repeats</strong>
            <i>Watch first · Pause anytime</i>
          </div>
          <a href="/how-it-works#manual-versus-automation">
            Explore Autopilot <span aria-hidden="true">↗</span>
          </a>
        </article>
        <article className="dm-mkt-breadth-card dm-mkt-breadth-compact dm-mkt-brief-card">
          <div className="dm-mkt-breadth-card-copy">
            <span className="dm-mkt-breadth-number">DAILY BRIEF · PRO</span>
            <h3>Read the day at a glance.</h3>
            <p>
              Daily Brief groups the latest changes into short, source-linked items you can scan.
            </p>
            <a href="/how-it-works#beyond-manual">
              Explore Daily Brief <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="dm-mkt-breadth-visual" aria-hidden="true">
            <span>YOUR DAILY EDITION</span>
            <strong>What needs a look today</strong>
            <i>Reply · For your information · Noise</i>
          </div>
        </article>
        <article className="dm-mkt-breadth-card dm-mkt-breadth-compact dm-mkt-followups-card">
          <div className="dm-mkt-breadth-card-copy">
            <span className="dm-mkt-breadth-number">FOLLOW-UPS · PRO</span>
            <h3>Keep a thread from slipping.</h3>
            <p>Find sent conversations that may need a follow-up, then open the thread in Gmail.</p>
            <a href="/how-it-works#beyond-manual">
              Explore Follow-ups <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="dm-mkt-breadth-visual" aria-hidden="true">
            <span>CONVERSATIONS</span>
            <strong>Conversations to revisit</strong>
            <i>Open in Gmail · Mark resolved</i>
          </div>
        </article>
      </div>
    </section>
  );
}

/** A short bridge from the sender walkthrough to the rest of the product. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="dm-mkt-section dm-mkt-shell dm-mkt-companion">
      <div className="dm-mkt-companion-head">
        <p className="dm-mkt-journey-kicker">A companion to Gmail</p>
        <h2 className="dm-mkt-h2">Keep your inbox. Get a better way to decide.</h2>
        <p className="dm-mkt-lede">
          Your mail stays in your existing Gmail account. DeclutrMail works alongside it for
          cleanup.
        </p>
        <a className="dm-mkt-cta-link" href="/how-it-works">
          Product guide →
        </a>
      </div>
      <div
        className="dm-mkt-companion-map"
        role="group"
        aria-label="Gmail and DeclutrMail work together"
      >
        <div>
          <span className="dm-mkt-companion-mark" aria-hidden="true">
            G
          </span>
          <strong>Gmail</strong>
          <p>Read and reply</p>
        </div>
        <span className="dm-mkt-companion-connector" aria-hidden="true">
          ↔
        </span>
        <div>
          <span className="dm-mkt-companion-mark" aria-hidden="true">
            d.
          </span>
          <strong>DeclutrMail</strong>
          <p>Review and clean up</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Privacy — a short trust answer with the full registry available on demand.
 *
 * The verification line may not exceed what /security#verification states:
 * Google APPROVED an OAuth verification for one restricted scope. It is not
 * a certification of the product, so never "certified" / "audited". The
 * date comes from shared copy because verification recertifies annually.
 */
export function PrivacyDesk() {
  return (
    <section id="privacy" className="dm-mkt-section dm-mkt-shell dm-mkt-privacy">
      <div className="dm-mkt-privacy-head">
        <p className="dm-mkt-journey-kicker">Privacy &amp; control</p>
        <h2 className="dm-mkt-h2">Know what we see. Keep the final say.</h2>
        <p className="dm-mkt-lede">{PRIVACY_BADGE_HEADLINE}</p>
        <div className="dm-mkt-privacy-links">
          <a href="/privacy">Privacy policy</a>
          <a
            href="/security#verification"
            title={`Google approved DeclutrMail's OAuth verification on ${CASA_VERIFICATION_APPROVED_ON} for the single restricted scope we request, gmail.modify.`}
          >
            Google OAuth verification approved, {CASA_VERIFICATION_APPROVED_MONTH} (CASA Tier 2)
          </a>
        </div>
      </div>
      <div className="dm-mkt-privacy-summary">
        <div>
          <strong>Only the details needed</strong>
          <p>Sender, subject, Gmail preview snippet and the signals used to show your options.</p>
        </div>
        <div>
          <strong>Access you can revoke</strong>
          <p>Disconnect Gmail, export your data or schedule permanent deletion of your account.</p>
        </div>
        <div>
          <strong>Your decisions remain yours</strong>
          <p>Review a live preview before mail moves. Turn on future rules separately.</p>
        </div>
        <details className="dm-mkt-privacy-inventory">
          <summary>Full data list</summary>
          <div className="dm-mkt-privacy-data">
            {[
              { label: PRIVACY_STORAGE_LABEL, items: PRIVACY_STORAGE_ITEMS },
              { label: PRIVACY_NEVER_LABEL, items: PRIVACY_NEVER_ITEMS },
            ].map(({ label, items }) => (
              <div key={label}>
                <strong>{label}</strong>
                <ul>
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
