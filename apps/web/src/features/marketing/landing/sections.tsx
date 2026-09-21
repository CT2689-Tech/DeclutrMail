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
 * statement lives in Privacy, the OAuth scope disclosure lives beside each
 * CTA that starts Google sign-in — none of them is repeated elsewhere.
 */

/** "Keep, Archive, Unsubscribe, Later, or Delete" — from the registry (D227). */
const VERB_LIST = new Intl.ListFormat('en', { type: 'disjunction' }).format(
  VERB_REGISTRY.map((verb) => verb.label),
);

/**
 * Why sender-by-sender is faster (one typographic moment), then the three
 * steps — a real sequence, so numbered — each with a small piece of product
 * UI instead of a paragraph.
 */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="dm-mkt-section dm-mkt-shell">
      <div className="dm-mkt-scale">
        <h2 className="dm-mkt-h2">Thousands of emails. Far fewer senders.</h2>
        <p className="dm-mkt-lede">Review each recurring sender once, not every email.</p>
        {/* The figures are an illustration, not a measurement, and the label
            beside them has to keep saying so. */}
        <p className="dm-mkt-scale-figures">
          <span className="dm-mkt-scale-figure">
            <b>12,418</b>
            <span>emails</span>
          </span>
          <span className="dm-mkt-scale-figure dm-mkt-scale-figure-to">
            <b>143</b>
            <span>decisions</span>
          </span>
        </p>
        <p className="dm-mkt-scale-note">Illustrative sample inbox</p>
      </div>

      <ol className="dm-mkt-steps">
        <li className="dm-mkt-step">
          <ConnectVignette />
          <h3 className="dm-mkt-step-title">Connect</h3>
          <p className="dm-mkt-step-body">
            One Google sign-in. DeclutrMail scans the sender, subject, and short preview line Gmail
            already shows you.
          </p>
        </li>
        <li className="dm-mkt-step">
          <ReviewVignette />
          <h3 className="dm-mkt-step-title">Review</h3>
          <p className="dm-mkt-step-body">Choose {VERB_LIST} with a preview before mail moves.</p>
        </li>
        <li className="dm-mkt-step">
          <UndoVignette />
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
        See the full product flow
      </a>
    </section>
  );
}

/* Vignettes are decoration beside text that already says the same thing,
   so they are hidden from assistive tech rather than described twice. */

/** One email row with the three details DeclutrMail reads marked. */
function ConnectVignette() {
  return (
    <div className="dm-mkt-vignette" aria-hidden="true">
      <div className="dm-mkt-vig-mail">
        <span className="dm-mkt-vig-mark">LinkedIn</span>
        <span className="dm-mkt-vig-mark">New jobs that match your profile</span>
        <span className="dm-mkt-vig-mark dm-mkt-vig-snippet">Product designer roles near you…</span>
      </div>
    </div>
  );
}

/** A sender row and the five decisions, Archive chosen. */
function ReviewVignette() {
  return (
    <div className="dm-mkt-vignette" aria-hidden="true">
      <div className="dm-mkt-vig-sender">
        <span className="dm-mkt-inbox-avatar">in</span>
        <b>LinkedIn</b>
        <span>412</span>
      </div>
      <div className="dm-mkt-vig-verbs">
        {VERB_REGISTRY.map((verb) => (
          <span
            key={verb.id}
            className={`dm-mkt-vig-verb${verb.id === 'archive' ? ' dm-mkt-vig-verb-on' : ''}`}
          >
            <kbd>{verb.shortcut}</kbd>
            {verb.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The product's one bottom pill: what happened, and Undo. */
function UndoVignette() {
  return (
    <div className="dm-mkt-vignette" aria-hidden="true">
      <div className="dm-mkt-vig-pill">
        <span>412 emails archived</span>
        <span className="dm-mkt-vig-undo">Undo</span>
      </div>
    </div>
  );
}

/**
 * Privacy — the one place on the page that makes the storage statement.
 * The badge IS the statement (headline + the list generated from the D245
 * registry). It renders from the shared component, not a copy of its
 * strings, so the page can never drift from the registry; the landing only
 * re-lays it out flat, as two columns (stores / never fetches).
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
        <h2 className="dm-mkt-h2">See exactly which Gmail details DeclutrMail stores.</h2>
        <p className="dm-mkt-lede">
          Disconnect Gmail at any time. Export your data or schedule permanent deletion of your
          account.
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
      <div className="dm-mkt-privacy-badge">
        <PrivacyBadge
          variant="card"
          style={{ background: 'transparent', border: 0, boxShadow: 'none', padding: 0 }}
        />
      </div>
    </section>
  );
}
