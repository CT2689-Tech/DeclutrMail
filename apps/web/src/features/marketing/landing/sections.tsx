import {
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
  PRIVACY_BADGE_HEADLINE,
  PrivacyBadge,
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
    <section className="dm-mkt-breadth dm-mkt-shell" aria-labelledby="dm-mkt-breadth-title">
      <div className="dm-mkt-breadth-heading">
        <p className="dm-mkt-journey-kicker">After the first cleanup</p>
        <h2 id="dm-mkt-breadth-title" className="dm-mkt-h2">
          A clearer inbox is only the beginning.
        </h2>
        <p className="dm-mkt-lede">
          DeclutrMail also helps you notice what changed, return to unanswered conversations, and
          decide which cleanup should repeat.
        </p>
      </div>
      <div className="dm-mkt-breadth-grid">
        <article className="dm-mkt-breadth-card">
          <span className="dm-mkt-breadth-number">01 / CATCH UP</span>
          <div className="dm-mkt-breadth-visual" aria-hidden="true">
            <span>YOUR DAILY EDITION</span>
            <strong>What needs a look today</strong>
            <i>Reply · For your information · Noise</i>
          </div>
          <h3>Read the day at a glance.</h3>
          <p>Daily Brief groups the latest changes into short, source-linked items you can scan.</p>
          <a href="/how-it-works#beyond-manual">
            Explore Daily Brief <span aria-hidden="true">↗</span>
          </a>
        </article>
        <article className="dm-mkt-breadth-card">
          <span className="dm-mkt-breadth-number">02 / FOLLOW THROUGH</span>
          <div className="dm-mkt-breadth-visual" aria-hidden="true">
            <span>CONVERSATIONS</span>
            <strong>Still waiting on a reply</strong>
            <i>Open in Gmail · Mark resolved</i>
          </div>
          <h3>Keep a thread from slipping.</h3>
          <p>
            Follow-ups surfaces sent conversations still waiting on a response, with a link back to
            Gmail.
          </p>
          <a href="/how-it-works#beyond-manual">
            Explore Follow-ups <span aria-hidden="true">↗</span>
          </a>
        </article>
        <article className="dm-mkt-breadth-card">
          <span className="dm-mkt-breadth-number">03 / KEEP IT CLEAR</span>
          <div className="dm-mkt-breadth-visual" aria-hidden="true">
            <span>RULE PREVIEW</span>
            <strong>Review before it repeats</strong>
            <i>Watch first · Pause anytime</i>
          </div>
          <h3>Put chosen rules to work.</h3>
          <p>
            Autopilot starts with suggestions and previews. You choose whether a rule only watches
            or takes action.
          </p>
          <a href="/how-it-works#manual-versus-automation">
            Explore Autopilot <span aria-hidden="true">↗</span>
          </a>
        </article>
      </div>
      <p className="dm-mkt-breadth-note">
        Daily Brief and Follow-ups are included with Pro. Autopilot starts with Plus.
      </p>
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
          Gmail stays where you read and reply. DeclutrMail brings each sender's context, a live
          action preview, and the recorded result into one clear flow.
        </p>
      </div>
      <a className="dm-mkt-cta-link" href="/how-it-works">
        See how the whole product works →
      </a>
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
        <h2 className="dm-mkt-h2">Know what we see. Keep the final say.</h2>
        <p className="dm-mkt-lede">
          {PRIVACY_BADGE_HEADLINE} Disconnect Gmail at any time. Export your data or schedule
          permanent deletion of your account.
        </p>
        <div className="dm-mkt-privacy-links">
          <a href="/privacy">Read the privacy policy</a>
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
          <strong>Full messages stay in Gmail</strong>
          <p>DeclutrMail does not fetch or store full email contents or attachments.</p>
        </div>
        <div>
          <strong>Your decisions remain yours</strong>
          <p>Review a live preview before mail moves. Turn on future rules separately.</p>
        </div>
        <details className="dm-mkt-privacy-inventory">
          <summary>See the full data list</summary>
          <div className="dm-mkt-privacy-badge">
            <PrivacyBadge
              variant="card"
              style={{ background: 'transparent', border: 0, boxShadow: 'none', padding: 0 }}
            />
          </div>
        </details>
      </div>
    </section>
  );
}
