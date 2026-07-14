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
      <h2 className="dm-mkt-h2">The cleanup is N decisions. We shrink N.</h2>
      <p className="dm-mkt-lede">
        Your inbox has thousands of emails — but they come from a few hundred senders. Tools that
        make you process emails leave you with the same N. DeclutrMail makes it N senders.
      </p>
      <div className="dm-mkt-arith">
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Illustrative sample inbox</div>
          <div className="dm-mkt-arith-value">12,418 emails</div>
          <p className="dm-mkt-arith-note">Years of newsletters, receipts, and notifications.</p>
        </div>
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Cleaning it email-by-email</div>
          <div className="dm-mkt-arith-value">
            <s>12,418 decisions</s>
          </div>
          <p className="dm-mkt-arith-note">That is why every “inbox zero” lapses.</p>
        </div>
        <div className="dm-mkt-arith-cell">
          <div className="dm-mkt-arith-label">Cleaning it by sender</div>
          <div className="dm-mkt-arith-value">
            <em>143 decisions</em>
          </div>
          <p className="dm-mkt-arith-note">One verdict per sender covers everything they sent.</p>
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
      <h2 className="dm-mkt-h2">Connect. Review. Done.</h2>
      <div className="dm-mkt-steps">
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 1</div>
          <h3 className="dm-mkt-step-title">Connect</h3>
          <p className="dm-mkt-step-body">
            One Google sign-in. We index sender, subject, and the short preview line Gmail already
            shows you — never full message bodies, never attachments.
          </p>
        </div>
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 2</div>
          <h3 className="dm-mkt-step-title">Review</h3>
          <p className="dm-mkt-step-body">
            Every plan can review ranked senders in Senders. Plus and Pro add the focused Triage
            queue. Choose Keep, Archive, Unsubscribe, Later, or Delete with a preview before mail
            moves.
          </p>
        </div>
        <div className="dm-mkt-step">
          <div className="dm-mkt-step-no">STEP 3</div>
          <h3 className="dm-mkt-step-title">Done</h3>
          <p className="dm-mkt-step-body">
            On Pro, Autopilot applies preset rules you explicitly enable to future matches. Manual
            decisions stay in the activity ledger, with undo for label-changing actions.
          </p>
        </div>
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
  later: 'Move matching inbox messages to DeclutrMail/Later. This is not Gmail’s timed Snooze.',
  delete:
    'Move matching inbox messages to Gmail Trash, normally for up to 30 days unless Trash is emptied sooner.',
};

/** D134 §5 wedge, framed as the five-verb ritual (D227 canonical verbs). */
export function Ritual() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 03 — The ritual</p>
      <h2 className="dm-mkt-h2">Five verbs. One per sender.</h2>
      <p className="dm-mkt-lede">
        Every sender in your inbox gets one of five verdicts, each on a single key. A live preview
        shows the current count, an available sample, and the planned Gmail changes. The worker
        re-checks Gmail at execution, and every final outcome lands in Activity.
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
              A cleanup tool only earns access to your inbox by being boringly specific about what
              it touches. The badge shows the Gmail message-field boundary; the privacy policy also
              itemizes account, preference, action, processor, and billing records.
            </p>
            <ul className="dm-mkt-desk-points">
              <li>
                We index metadata, not full mail. The badge on the right names the Gmail message
                fields used by the product.
              </li>
              <li>
                Manual mail-moving actions are previewed before they run and journaled after.
                Enabled Pro Autopilot rules apply future matches without per-message approval and
                are journaled after execution. Delivered unsubscribe requests are one-way and are
                called out as such before approval.
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

/** D134 §6 — honest product proof, with the tier that unlocks each chapter. */
export function ProductTour() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 05 — What you actually get</p>
      <h2 className="dm-mkt-h2">Three product chapters, not three quota bands.</h2>
      <p className="dm-mkt-lede">
        Free helps you see the sender pattern. Plus opens the manual review workflow. Pro adds
        preset automation for recurring matches. The same Activity record ties all three together.
      </p>
      <div className="dm-mkt-product-tour">
        <article>
          <div className="dm-mkt-product-tier">Plus · Decide</div>
          <h3>Triage</h3>
          <p>
            A ranked sender queue with Keep, Archive, Unsubscribe, and Later. Expand a row, inspect
            the signals, then approve the current count-and-sample preview.
          </p>
          <div className="dm-mkt-product-mini" aria-hidden="true">
            <span className="dm-mkt-product-avatar">L</span>
            <span>
              <b>LinkedIn Notifications</b>
              <small>47/mo · 8% read</small>
            </span>
            <em>Archive · 92%</em>
          </div>
        </article>
        <article>
          <div className="dm-mkt-product-tier">Pro · Automate</div>
          <h3>Autopilot</h3>
          <p>
            Preset rules begin in Observe mode. Review what a rule would have matched, then enable
            it for future mail. Pause it whenever you want.
          </p>
          <div className="dm-mkt-product-rule" aria-hidden="true">
            <span>Observe</span>
            <b>Archive low-engagement promotions</b>
            <small>18 sample matches · no actions yet</small>
          </div>
        </article>
        <article>
          <div className="dm-mkt-product-tier">All plans · Audit</div>
          <h3>Activity</h3>
          <p>
            Confirmed outcomes live in one ledger. Undo appears only where the underlying action is
            reversible; a delivered unsubscribe request is clearly marked one-way.
          </p>
          <div className="dm-mkt-product-activity" aria-hidden="true">
            <span>
              <b>Archived · GitHub</b>
              <small>74 messages · All Mail</small>
            </span>
            <em>Undo · 7d</em>
          </div>
        </article>
      </div>
      <div className="dm-mkt-section-link-row">
        <a href="/inbox-simulator">Try the real interaction →</a>
        <a href="/how-it-works">See the full product flow →</a>
      </div>
    </section>
  );
}

/** Gmail migration bridge — familiar concepts stay anchored to Gmail. */
export function GmailCompanion() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 06 — Gmail stays home</p>
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
            <li>Preview sender-wide Archive, Later, or Delete scopes</li>
            <li>Enable explicit preset rules for future matches</li>
            <li>Audit outcomes and use Activity undo where available</li>
          </ul>
        </div>
      </div>
      <div
        className="dm-mkt-gmail-map"
        role="table"
        aria-label="DeclutrMail actions in Gmail terms"
      >
        <div role="row">
          <b role="cell">Archive</b>
          <span role="cell">Remove from Inbox · keep in All Mail</span>
        </div>
        <div role="row">
          <b role="cell">Later</b>
          <span role="cell">Move existing inbox mail to DeclutrMail/Later · not timed Snooze</span>
        </div>
        <div role="row">
          <b role="cell">Delete</b>
          <span role="cell">
            Move to Gmail Trash · retained for up to 30 days unless emptied sooner
          </span>
        </div>
        <div role="row">
          <b role="cell">Unsubscribe</b>
          <span role="cell">Ask the sender to stop future mail · delivered request is one-way</span>
        </div>
      </div>
      <div className="dm-mkt-section-link-row">
        <a href="/vs/gmail-filters">Compare with Gmail filters →</a>
        <a href="/help#verbs-in-gmail-terms">Read the Gmail terminology guide →</a>
      </div>
    </section>
  );
}
