import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';
import { ACTION_REGISTRY, VERB_REGISTRY, type VerbId } from '@declutrmail/shared/actions';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

// All five render in Triage as of the 2026-08-06 founder amendment to
// ADR-0019. Delete is never an engine recommendation — it is user-chosen,
// danger-toned, and always previewed — but it IS on the toolbar, so this
// figure must show it or the page draws a Triage that no longer exists.
const TRIAGE_VERBS = [
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
] as const satisfies readonly VerbId[];

const ACTION_CLARIFIERS: Readonly<Record<VerbId, string>> = {
  keep: 'Keep records your decision and leaves email where it is. Protect is separate: it keeps a sender out of bulk and automatic changes.',
  archive:
    'Archive applies only to the emails shown before you confirm. New mail from the sender is unchanged.',
  unsubscribe:
    'A sent one-click unsubscribe request cannot be taken back. Existing email stays where it is unless you choose another action.',
  later:
    'Later moves the emails shown in the preview to DeclutrMail/Later until the return time you choose. New mail from the sender is unchanged.',
  delete:
    'Delete is never recommended for you — you pick it yourself, and it always shows a full preview first. It moves the previewed mail to Gmail Trash, where Gmail normally keeps it for 30 days.',
};

/** All content remains visible; motion only moves the focus ring between steps. */
export function ProductWalkthroughFigure() {
  return (
    <figure
      className="dm-story-figure dm-story-walkthrough"
      aria-labelledby="dm-story-walkthrough-title"
    >
      <figcaption id="dm-story-walkthrough-title">
        Made-up walkthrough — sample sender and counts, never a real mailbox
      </figcaption>
      <ol>
        <li className="dm-story-walkthrough-step">
          <span className="dm-story-step-label">1 · Review</span>
          <strong>LinkedIn Updates</strong>
          <span>47 inbox messages · 8% read</span>
          <small>Archive is suggested because of the volume and low read rate.</small>
        </li>
        <li className="dm-story-walkthrough-step">
          <span className="dm-story-step-label">2 · Preview</span>
          <strong>Archive 47 current messages?</strong>
          <span>Moves them out of Inbox and keeps them searchable in Gmail All Mail.</span>
          <small>Future LinkedIn mail is unaffected by this manual action.</small>
        </li>
        <li className="dm-story-walkthrough-step">
          <span className="dm-story-step-label">3 · Confirmed</span>
          <strong>Archived · 47 messages</strong>
          <span>Recorded in Activity after Gmail confirms the change.</span>
          <small>Undo available for {MIN_UNDO_WINDOW_DAYS} days on every plan.</small>
        </li>
      </ol>
    </figure>
  );
}

export function ActionSemanticsGrid() {
  return (
    <div className="dm-story-action-grid">
      {TRIAGE_VERBS.map((id) => {
        const presentation = VERB_REGISTRY.find((verb) => verb.id === id);
        const action = ACTION_REGISTRY[id];
        if (!presentation) return null;
        return (
          <article
            key={id}
            // Delete keeps its danger styling, but as a modifier on the
            // ONE card the map produces. It used to be a second hardcoded
            // card appended below, because `TRIAGE_VERBS` deliberately
            // excluded delete — adding delete to that array without
            // removing the card rendered Delete twice on /how-it-works.
            className={
              id === 'delete'
                ? 'dm-story-action-card dm-story-action-card-delete'
                : 'dm-story-action-card'
            }
          >
            <div className="dm-story-action-title">
              <kbd>{presentation.shortcut}</kbd>
              <h3>{action.copy.primary}</h3>
            </div>
            <p>{action.copy.description}</p>
            <p className="dm-story-action-clarifier">{ACTION_CLARIFIERS[id]}</p>
          </article>
        );
      })}
    </div>
  );
}

export function GmailBridgeTable() {
  // One number for the whole ladder since 2026-08-23 (undo is uniform).
  // Still reduced across tiers rather than pinned to one, so if the
  // windows ever diverge again this renders the FLOOR instead of a
  // stale split — the previous copy hardcoded the shape "N on
  // Free/Plus, M on Pro" AROUND derived numbers, which is how true
  // values end up inside a false sentence.
  const undoDays = MIN_UNDO_WINDOW_DAYS;
  return (
    <div
      className="dm-story-table-wrap"
      role="region"
      tabIndex={0}
      aria-labelledby="dm-story-gmail-table-title"
    >
      <table className="dm-story-table">
        <caption id="dm-story-gmail-table-title">
          How each DeclutrMail decision maps to Gmail
        </caption>
        <thead>
          <tr>
            <th scope="col">DeclutrMail decision</th>
            <th scope="col">What changes in Gmail</th>
            <th scope="col">Future mail</th>
            <th scope="col">Undo or recovery</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Keep</th>
            <td>No Gmail label changes; your decision is recorded.</td>
            <td>
              Keep remains your decision for this sender. Protect is a separate safety control.
            </td>
            <td>Nothing in Gmail changes.</td>
          </tr>
          <tr>
            <th scope="row">Archive</th>
            <td>Moves the previewed emails out of Inbox; they remain in All Mail.</td>
            <td>New mail is unchanged unless you separately turn on an Autopilot rule.</td>
            <td>Undo: {undoDays} days on every plan.</td>
          </tr>
          <tr>
            <th scope="row">Unsubscribe</th>
            <td>
              Sends a published one-click request, or prepares a Gmail draft for manual mailto.
            </td>
            <td>The sender may stop mailing after accepting the request.</td>
            <td>
              A sent request is one-way. Any action on existing email has its own preview and Undo.
            </td>
          </tr>
          <tr>
            <th scope="row">Later</th>
            <td>Moves the previewed email out of Inbox and adds DeclutrMail/Later.</td>
            <td>New mail is unchanged unless you separately turn on an Autopilot rule.</td>
            <td>Undo: {undoDays} days on every plan.</td>
          </tr>
          <tr>
            <th scope="row">Delete</th>
            <td>Moves previewed current mail to Gmail Trash.</td>
            <td>New mail is unchanged unless you separately turn on an Autopilot rule.</td>
            <td>
              Activity Undo: {undoDays} days on every plan. Gmail Trash is a separate fallback,
              normally up to 30 days unless emptied sooner.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DataBoundaryFigure() {
  return (
    <figure className="dm-story-figure" aria-labelledby="dm-story-data-title">
      <figcaption id="dm-story-data-title">What DeclutrMail stores from Gmail</figcaption>
      <div className="dm-story-boundary">
        <div className="dm-story-boundary-node">
          <span className="dm-story-step-label">Your inbox stays here</span>
          <strong>Gmail</strong>
          <p>
            Gmail remains the system of record and the place where messages are read and replied to.
          </p>
        </div>
        <div className="dm-story-boundary-node dm-story-boundary-allow">
          <span className="dm-story-step-label">DeclutrMail stores</span>
          <strong>{PRIVACY_STORAGE_LABEL}</strong>
          <ul>
            {PRIVACY_STORAGE_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="dm-story-boundary-node dm-story-boundary-stop">
          <span className="dm-story-step-label">DeclutrMail does not take</span>
          <strong>{PRIVACY_NEVER_LABEL}</strong>
          <ul>
            {PRIVACY_NEVER_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="dm-story-figure-note">
        <strong>{PRIVACY_BADGE_HEADLINE}</strong> A Gmail preview snippet is the short text Gmail
        already shows in your inbox list.
      </p>
    </figure>
  );
}

export function ActionLifecycleFigure() {
  const steps = [
    ['Choose', 'You choose an action or approve a suggested batch.'],
    ['Options', 'Choose a time range or return time when the action needs one.'],
    ['Preview', 'See the current number of affected emails and a sample when available.'],
    ['Confirm', 'DeclutrMail makes the confirmed Gmail change or sends the unsubscribe request.'],
    ['Activity', 'See the result after Gmail or the sender confirms it.'],
    ['Undo', 'Reverse Archive, Later, or Delete until the deadline shown in Activity.'],
  ] as const;
  return (
    <figure className="dm-story-figure" aria-labelledby="dm-story-lifecycle-title">
      <figcaption id="dm-story-lifecycle-title">What happens when you confirm an action</figcaption>
      <ol className="dm-story-flow">
        {steps.map(([title, body], index) => (
          <li key={title}>
            <span>{index + 1}</span>
            <strong>{title}</strong>
            <small>{body}</small>
          </li>
        ))}
      </ol>
      <p className="dm-story-figure-note">
        Gmail confirms each label change. For one-click lists, the sender&rsquo;s system reports
        whether it accepted the request. The delivered unsubscribe request cannot be undone; any
        paired Archive has its own Undo record. Autopilot follows the separate rule path below and
        does not ask for approval on each matching batch once you turn a rule on.
      </p>
    </figure>
  );
}

export function AutomationBoundaryFigure() {
  return (
    <figure className="dm-story-figure" aria-labelledby="dm-story-automation-title">
      <figcaption id="dm-story-automation-title">
        Manual decisions and future automation are separate
      </figcaption>
      <div className="dm-story-rule-paths">
        <div>
          <span className="dm-story-step-label">Free · Plus · Pro</span>
          <h3>Manual cleanup</h3>
          <p>
            Archive, Later, and Delete act on the current messages named in the mandatory preview.
            They do not quietly turn into future-mail rules.
          </p>
        </div>
        <div>
          {/* Preset rules start at Plus. Both run modes are a user
              choice on any plan that has Autopilot, so the body states
              the behaviour without a plan claim. */}
          <span className="dm-story-step-label">Plus · Pro</span>
          <h3>Autopilot preset rule</h3>
          <p>
            Turning a preset on shows what it would do first, then it acts on future matches. Choose
            Watch first instead and it records what it would match without moving mail, for your
            approval. It can be paused again.
          </p>
        </div>
      </div>
    </figure>
  );
}

export function RecommendationCascadeFigure() {
  const steps = [
    [
      'Protected senders first',
      'A sender you protect is excluded. Replies, stars, and frequent reading can also protect a sender automatically.',
    ],
    [
      'Enough information?',
      'Very new or low-volume senders become Later instead of forcing a suggestion.',
    ],
    [
      'Compare Archive and Unsubscribe',
      'DeclutrMail uses facts such as volume, read rate, previous archives, and whether the sender offers unsubscribe.',
    ],
    [
      'Show why',
      'The suggested action and the facts behind it appear together. You make the final decision.',
    ],
  ] as const;

  return (
    <figure className="dm-story-figure" aria-labelledby="dm-story-recommendation-title">
      <figcaption id="dm-story-recommendation-title">How DeclutrMail suggests an action</figcaption>
      <ol className="dm-story-flow dm-story-flow-four">
        {steps.map(([title, body], index) => (
          <li key={title}>
            <span>{index + 1}</span>
            <strong>{title}</strong>
            <small>{body}</small>
          </li>
        ))}
      </ol>
      <p className="dm-story-figure-note">
        DeclutrMail does not predict email categories. When a Gmail category is present, it is
        Gmail&rsquo;s own label and only one of the facts DeclutrMail considers.
      </p>
    </figure>
  );
}
