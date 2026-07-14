import { PrivacyBadge } from '@declutrmail/shared';
import { VERB_REGISTRY } from '@declutrmail/shared/actions';

/**
 * Landing body sections (D134 §§3–5 + privacy posture).
 *
 * All server-rendered; zero client JS. Verb rows read the canonical
 * registry (D227/ADR-0019) so labels + shortcuts can never drift from
 * the product surface.
 */

/** D134 §3 — the problem statement as inbox arithmetic. */
export function Problem() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 01 — The arithmetic</p>
      <h2 className="dm-mkt-h2">The work is N decisions. We shrink N.</h2>
      <p className="dm-mkt-lede">
        Your inbox has thousands of emails — but they come from a few hundred senders. Tools that
        make you process emails leave you with the same N. DeclutrMail makes it N senders.
      </p>
      <div className="dm-mkt-arith">
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">A typical inbox</div>
          <div className="dm-mkt-arith-value">12,418 emails</div>
          <p className="dm-mkt-arith-note">Years of newsletters, receipts, and notifications.</p>
        </div>
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Handling it email-by-email</div>
          <div className="dm-mkt-arith-value">
            <s>12,418 decisions</s>
          </div>
          <p className="dm-mkt-arith-note">That is why every “inbox zero” lapses.</p>
        </div>
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Handling it by sender</div>
          <div className="dm-mkt-arith-value">
            <em>143 decisions</em>
          </div>
          <p className="dm-mkt-arith-note">One verdict per sender covers everything they sent.</p>
        </div>
      </div>
    </section>
  );
}

/** D134 §4 — Connect → Triage → Done. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 02 — How it works</p>
      <h2 className="dm-mkt-h2">Connect. Triage. Done.</h2>
      <div className="dm-mkt-steps">
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 1</div>
          <h3 className="dm-mkt-step-title">Connect</h3>
          <p className="dm-mkt-step-body">
            One Google sign-in. We index sender, subject, and the short preview line Gmail already
            shows you — never message bodies, never attachments.
          </p>
        </div>
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 2</div>
          <h3 className="dm-mkt-step-title">Triage</h3>
          <p className="dm-mkt-step-body">
            Your senders arrive ranked by volume and attention. One decision each — Keep, Archive,
            Unsubscribe, Later, or Delete — with a preview before anything moves.
          </p>
        </div>
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 3</div>
          <h3 className="dm-mkt-step-title">Done</h3>
          <p className="dm-mkt-step-body">
            Active rules apply to matching mail, and Activity records each result along with any
            available undo.
          </p>
        </div>
      </div>
    </section>
  );
}

/** One-line explainer per canonical verb, keyed by registry id. */
const VERB_EXPLAINERS: Record<(typeof VERB_REGISTRY)[number]['id'], string> = {
  keep: 'Protect a sender. Their mail stays in your inbox, untouched by any rule.',
  archive: 'Out of the inbox, never lost — everything stays searchable in Gmail.',
  unsubscribe:
    'One-click unsubscribe where the sender supports it. Past mail stays unless you separately archive or delete it.',
  later: 'Move current inbox mail to the DeclutrMail/Later label. Future mail is unchanged.',
  delete: 'Move a sender’s mail to Gmail Trash. Recoverable there for 30 days.',
};

/** D134 §5 wedge, framed as the five-verb ritual (D227 canonical verbs). */
export function Ritual() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 03 — The ritual</p>
      <h2 className="dm-mkt-h2">Five verbs. One per sender.</h2>
      <p className="dm-mkt-lede">
        Every sender in your inbox gets exactly one of five verdicts, each on a single key. A
        preview shows you precisely what will move before anything does. The preview also explains
        whether and how the action can be reversed.
      </p>
      <div className="dm-mkt-ritual">
        {VERB_REGISTRY.map((verb) => (
          <div
            key={verb.id}
            className={`dm-mkt-ritual-row${verb.id === 'delete' ? ' dm-mkt-ritual-row-delete' : ''}`}
          >
            <kbd className="dm-mkt-ritual-key">{verb.shortcut}</kbd>
            <span className="dm-mkt-ritual-verb">{verb.label}</span>
            <span className="dm-mkt-ritual-desc">{VERB_EXPLAINERS[verb.id]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Privacy posture — full-bleed ink desk with the D228 badge as paper. */
export function PrivacyDesk() {
  return (
    <section id="privacy" className="dm-mkt-desk-section">
      <div className="dm-mkt-shell">
        <div className="dm-mkt-desk-grid">
          <div>
            <p className="dm-mkt-eyebrow">№ 04 — The fine print, first</p>
            <h2 className="dm-mkt-h2">Built for the most skeptical person in the room.</h2>
            <p className="dm-mkt-lede">
              An inbox tool only earns access to your mail by being boringly specific about what it
              touches. So here is the whole list, on the badge — the same one shown inside the
              product.
            </p>
            <ul className="dm-mkt-desk-points">
              <li>
                We do not fetch full message bodies or attachments. The badge lists the Gmail data
                used by the product.
              </li>
              <li>
                Mail-changing actions are previewed before they run and recorded afterward. Any
                available undo is enforced server-side.
              </li>
              <li>
                Disconnect any time. Deleting your account schedules a full purge of the little we
                kept.
              </li>
            </ul>
            <a href="/privacy" className="dm-mkt-desk-link">
              Read the privacy policy →
            </a>
          </div>
          <div className="dm-mkt-desk-paper">
            <PrivacyBadge variant="card" />
          </div>
        </div>
      </div>
    </section>
  );
}
