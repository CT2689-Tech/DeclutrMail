import {
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
  PrivacyBadge,
} from '@declutrmail/shared';
import { VERB_REGISTRY } from '@declutrmail/shared/actions';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

/**
 * Landing body sections. All server-rendered; zero client JS.
 *
 * Each block states its idea once. Undo lives in How it works, the storage
 * statement lives in Privacy, the OAuth scope disclosure lives beside the
 * final CTA — none of them is repeated elsewhere on the page.
 */

/** "Keep, Archive, Unsubscribe, Later, or Delete" — from the registry (D227). */
const VERB_LIST = new Intl.ListFormat('en', { type: 'disjunction' }).format(
  VERB_REGISTRY.map((verb) => verb.label),
);

/** Why sender-by-sender is faster, then Connect → Review → Undo. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="dm-mkt-section dm-mkt-shell dm-mkt-center">
      <h2 className="dm-mkt-h2">Thousands of emails. Far fewer senders.</h2>
      <p className="dm-mkt-lede">Review each recurring sender once, not every email.</p>
      {/* The figures are an illustration, not a measurement, and the label
          under them has to keep saying so. */}
      <p className="dm-mkt-sum">
        <span>
          <b>12,418</b> emails
        </span>
        <span className="dm-mkt-sum-arrow" aria-hidden="true">
          →
        </span>
        <span>
          <b className="dm-mkt-sum-accent">143</b> decisions
        </span>
      </p>
      <p className="dm-mkt-sum-note">Illustrative sample inbox</p>
      <ol className="dm-mkt-steps">
        <li className="dm-mkt-step">
          <h3 className="dm-mkt-step-title">Connect</h3>
          <p className="dm-mkt-step-body">
            One Google sign-in. DeclutrMail scans the sender, subject, and short preview line Gmail
            already shows you.
          </p>
        </li>
        <li className="dm-mkt-step">
          <h3 className="dm-mkt-step-title">Review</h3>
          <p className="dm-mkt-step-body">Choose {VERB_LIST} with a preview before mail moves.</p>
        </li>
        <li className="dm-mkt-step">
          <h3 className="dm-mkt-step-title">Undo</h3>
          {/* The last sentence is a disclosure, not help text: Unsubscribe is
              the one decision Undo cannot reach. */}
          <p className="dm-mkt-step-body">
            Undo Archive, Later, or Delete for {MIN_UNDO_WINDOW_DAYS} days. Sent unsubscribe
            requests cannot be taken back.
          </p>
        </li>
      </ol>
      <a className="dm-mkt-cta-link" href="/how-it-works">
        See the full product flow <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}

/**
 * Privacy — the one place on the page that makes the storage statement.
 * The badge IS the statement (headline + the list generated from the D245
 * registry), so the h2 only says what the card is and scopes it to Gmail
 * details; account and billing records are the privacy policy's job.
 *
 * The verification line may not exceed what /security#verification states:
 * Google APPROVED an OAuth verification for one restricted scope. It is not
 * a certification of the product, so never "certified" / "audited". The
 * date comes from shared copy because verification recertifies annually.
 */
export function PrivacyDesk() {
  return (
    <section id="privacy" className="dm-mkt-desk-section">
      <div className="dm-mkt-shell">
        <div className="dm-mkt-desk-grid">
          <div>
            <h2 className="dm-mkt-h2">See exactly which Gmail details DeclutrMail stores.</h2>
            <p className="dm-mkt-lede">
              Disconnect Gmail at any time. Export your data or schedule permanent deletion of your
              account.
            </p>
            <div className="dm-mkt-desk-links">
              <a href="/privacy">
                Read the privacy policy <span aria-hidden="true">→</span>
              </a>
              <a
                href="/security#verification"
                title={`Google approved DeclutrMail's OAuth verification on ${CASA_VERIFICATION_APPROVED_ON} for the single restricted scope we request, gmail.modify.`}
              >
                Google OAuth verification approved, {CASA_VERIFICATION_APPROVED_MONTH} (CASA Tier 2)
              </a>
            </div>
          </div>
          <PrivacyBadge variant="card" />
        </div>
      </div>
    </section>
  );
}
