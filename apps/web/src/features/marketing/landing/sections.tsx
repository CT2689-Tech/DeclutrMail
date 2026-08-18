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
      <p className="dm-mkt-eyebrow">№ 01 — Why sender cleanup is faster</p>
      <h2 className="dm-mkt-h2">Thousands of emails. Far fewer senders.</h2>
      <p className="dm-mkt-lede">
        Instead of reviewing every email, review each recurring sender once. One decision can cover
        the email that sender already added to your inbox.
      </p>
      <div className="dm-mkt-arith">
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Illustrative sample inbox</div>
          <div className="dm-mkt-arith-value">12,418 emails</div>
          <p className="dm-mkt-arith-note">Years of newsletters, receipts, and notifications.</p>
        </div>
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Reviewed email by email</div>
          <div className="dm-mkt-arith-value">
            <s>12,418 decisions</s>
          </div>
          <p className="dm-mkt-arith-note">The same sender appears again and again.</p>
        </div>
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Reviewed sender by sender</div>
          <div className="dm-mkt-arith-value">
            <em>143 decisions</em>
          </div>
          <p className="dm-mkt-arith-note">
            One decision covers that sender&rsquo;s matching email.
          </p>
        </div>
      </div>
    </section>
  );
}

/** D134 §4 — Connect → Review → Done. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 02 — How it works</p>
      <h2 className="dm-mkt-h2">Connect Gmail. Review senders. Confirm each change.</h2>
      <div className="dm-mkt-steps">
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 1</div>
          <h3 className="dm-mkt-step-title">Connect</h3>
          <p className="dm-mkt-step-body">
            One Google sign-in. We scan the sender, subject, and short preview line Gmail already
            shows you — never full email contents or attachments.
          </p>
        </div>
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 2</div>
          <h3 className="dm-mkt-step-title">Review</h3>
          <p className="dm-mkt-step-body">
            Every plan reviews ranked senders in Senders and the focused Triage queue. Choose Keep,
            Archive, Unsubscribe, Later, or Delete with a preview before mail moves.
          </p>
        </div>
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 3</div>
          <h3 className="dm-mkt-step-title">Keep control</h3>
          <p className="dm-mkt-step-body">
            Activity shows what happened and when Undo is available. Plus can collect matching mail
            for your approval. Pro can run only the rules you deliberately turn on. Sent unsubscribe
            requests cannot be taken back.
          </p>
        </div>
      </div>
      <h3 className="dm-mkt-ritual-title">Five decisions, one clear result each.</h3>
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
      <div className="dm-mkt-section-link-row">
        <a href="/inbox-simulator">Try the real interaction →</a>
        <a href="/how-it-works">See the full product flow →</a>
      </div>
    </section>
  );
}

/** One-line explainer per canonical verb, keyed by registry id. */
const VERB_EXPLAINERS: Record<(typeof VERB_REGISTRY)[number]['id'], string> = {
  keep: 'Record a Keep decision and leave this sender’s mail in the inbox. Protect is a separate setting.',
  archive: 'Move matching inbox messages out of Inbox. They remain searchable in All Mail.',
  unsubscribe:
    'Request that the sender stop future mail. Existing messages stay put unless you choose another action.',
  later:
    'Move matching inbox email to DeclutrMail/Later until the return time you choose for that sender.',
  delete:
    'Move matching inbox messages to Gmail Trash, normally for up to 30 days unless Trash is emptied sooner.',
};

/** Privacy posture — full-bleed ink desk with the D228 badge as paper. */
export function PrivacyDesk() {
  return (
    <section id="privacy" className="dm-mkt-desk-section">
      <div className="dm-mkt-shell">
        <div className="dm-mkt-desk-grid">
          <div>
            <p className="dm-mkt-eyebrow">№ 03 — Your email data</p>
            <h2 className="dm-mkt-h2">See exactly what DeclutrMail stores.</h2>
            <p className="dm-mkt-lede">
              DeclutrMail uses a limited set of Gmail details to group and review senders. The list
              shows what is stored and what never leaves Gmail. The privacy policy covers the other
              account and billing information needed to run the service.
            </p>
            <ul className="dm-mkt-desk-points">
              <li>
                We store only the Gmail details listed here, never the full contents of an email.
              </li>
              <li>
                Before a manual action moves email, you see what will change. Activity records the
                result and shows Undo when it is available. Sent unsubscribe requests are clearly
                marked as one-way.
              </li>
              <li>
                Disconnect Gmail at any time. You can also export your data or schedule permanent
                deletion of your DeclutrMail account.
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

/** Gmail migration bridge — familiar concepts stay anchored to Gmail. */
export function GmailCompanion() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 04 — Gmail stays home</p>
      <h2 className="dm-mkt-h2">A control companion, not a replacement inbox.</h2>
      <p className="dm-mkt-lede">
        Keep using Gmail for messages. Open DeclutrMail when the sender pattern—not one email—is the
        problem.
      </p>
      <div className="dm-mkt-companion-grid">
        <div>
          <p>Keep doing this in Gmail</p>
          <ul>
            <li>Read, reply, forward, and compose</li>
            <li>Search message content and attachments</li>
            <li>Star, mark important, and manage threads</li>
            <li>Use native Snooze for a message with a return time</li>
          </ul>
        </div>
        <div>
          <p>Use DeclutrMail for this</p>
          <ul>
            <li>Rank recurring senders by volume and attention</li>
            <li>See which emails Archive, Later, or Delete will affect</li>
            <li>Turn on preset rules for future matching mail</li>
            <li>Review results and use Activity Undo when available</li>
          </ul>
        </div>
      </div>
      <div className="dm-mkt-section-link-row">
        <a href="/vs/gmail-filters">Compare with Gmail filters →</a>
        <a href="/help#actions-in-gmail-terms">See what each action does in Gmail →</a>
      </div>
    </section>
  );
}
