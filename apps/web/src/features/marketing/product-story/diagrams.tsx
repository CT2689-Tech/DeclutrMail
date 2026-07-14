import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';
import { ACTION_REGISTRY, VERB_REGISTRY, type VerbId } from '@declutrmail/shared/actions';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

const TRIAGE_VERBS = [
  'keep',
  'archive',
  'unsubscribe',
  'later',
] as const satisfies readonly VerbId[];

const ACTION_CLARIFIERS: Readonly<Record<VerbId, string>> = {
  keep: 'Keep records your decision and leaves mail where it is. It is not Protect; Protect is a separate shield against destructive and bulk actions.',
  archive:
    'A manual Archive applies to the current messages named in the preview. It does not silently become a future-mail rule.',
  unsubscribe:
    'A delivered one-click unsubscribe cannot be recalled. Existing inbox mail stays put unless you separately choose a backlog action.',
  later:
    'Later moves the current messages in the preview into DeclutrMail/Later. It is not a timed Snooze and does not silently create a future rule.',
  delete:
    'Delete is available from Senders and Sender Detail, not the daily Triage toolbar. It moves the previewed mail to Gmail Trash.',
};

/** All content remains visible; motion only moves the focus ring between steps. */
export function ProductWalkthroughFigure() {
  return (
    <figure
      className="dm-story-figure dm-story-walkthrough"
      aria-labelledby="dm-story-walkthrough-title"
    >
      <figcaption id="dm-story-walkthrough-title">
        Synthetic walkthrough — sample sender and counts, never a real mailbox
      </figcaption>
      <ol>
        <li className="dm-story-walkthrough-step">
          <span className="dm-story-step-label">1 · Review</span>
          <strong>LinkedIn Updates</strong>
          <span>47 inbox messages · 8% read</span>
          <small>Suggested Archive from inspectable volume and engagement signals.</small>
        </li>
        <li className="dm-story-walkthrough-step">
          <span className="dm-story-step-label">2 · Preview</span>
          <strong>Archive 47 current messages?</strong>
          <span>Removes INBOX; keeps the messages searchable in Gmail All Mail.</span>
          <small>Future LinkedIn mail is unaffected by this manual action.</small>
        </li>
        <li className="dm-story-walkthrough-step">
          <span className="dm-story-step-label">3 · Confirmed</span>
          <strong>Archived · 47 messages</strong>
          <span>Recorded in Activity after Gmail confirms the change.</span>
          <small>
            Undo available for {TIER_MANIFEST.free.undoWindowDays} days on Free and Plus.
          </small>
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
          <article key={id} className="dm-story-action-card">
            <div className="dm-story-action-title">
              <kbd>{presentation.shortcut}</kbd>
              <h3>{action.copy.primary}</h3>
            </div>
            <p>{action.copy.description}</p>
            <p className="dm-story-action-clarifier">{ACTION_CLARIFIERS[id]}</p>
          </article>
        );
      })}
      <article className="dm-story-action-card dm-story-action-card-delete">
        <div className="dm-story-action-title">
          <kbd>{VERB_REGISTRY.find((verb) => verb.id === 'delete')?.shortcut ?? 'D'}</kbd>
          <h3>{ACTION_REGISTRY.delete.copy.primary}</h3>
        </div>
        <p>{ACTION_REGISTRY.delete.copy.description}</p>
        <p className="dm-story-action-clarifier">{ACTION_CLARIFIERS.delete}</p>
      </article>
    </div>
  );
}

export function GmailBridgeTable() {
  const freeDays = TIER_MANIFEST.free.undoWindowDays;
  const proDays = TIER_MANIFEST.pro.undoWindowDays;
  return (
    <div
      className="dm-story-table-wrap"
      role="region"
      tabIndex={0}
      aria-labelledby="dm-story-gmail-table-title"
    >
      <table className="dm-story-table">
        <caption id="dm-story-gmail-table-title">How each DeclutrMail choice maps to Gmail</caption>
        <thead>
          <tr>
            <th scope="col">DeclutrMail choice</th>
            <th scope="col">What changes in Gmail</th>
            <th scope="col">Future mail</th>
            <th scope="col">Safety boundary</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Keep</th>
            <td>No Gmail label change; the sender decision is recorded.</td>
            <td>Keep is a standing decision. Protect remains a separate user-controlled shield.</td>
            <td>No destructive mutation.</td>
          </tr>
          <tr>
            <th scope="row">Archive</th>
            <td>Removes INBOX from the previewed current messages; they remain in All Mail.</td>
            <td>Unaffected unless a separate Pro rule is enabled.</td>
            <td>
              Undo: {freeDays} days on Free/Plus, {proDays} on Pro.
            </td>
          </tr>
          <tr>
            <th scope="row">Unsubscribe</th>
            <td>
              Sends a published one-click request, or prepares a Gmail draft for manual mailto.
            </td>
            <td>The sender may stop mailing after accepting the request.</td>
            <td>
              The delivered request is one-way. Backlog actions have their own preview and undo.
            </td>
          </tr>
          <tr>
            <th scope="row">Later</th>
            <td>Moves previewed current mail out of INBOX and adds DeclutrMail/Later.</td>
            <td>Unaffected unless a separate Pro rule is enabled.</td>
            <td>
              Undo: {freeDays} days on Free/Plus, {proDays} on Pro.
            </td>
          </tr>
          <tr>
            <th scope="row">Delete</th>
            <td>Moves previewed current mail to Gmail Trash.</td>
            <td>Unaffected unless a separate Pro rule is enabled.</td>
            <td>
              Activity can undo for up to 30 days while Gmail retains the message; emptying Trash
              can end recovery sooner.
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
      <figcaption id="dm-story-data-title">The Gmail message-data boundary</figcaption>
      <div className="dm-story-boundary">
        <div className="dm-story-boundary-node">
          <span className="dm-story-step-label">Source</span>
          <strong>Gmail</strong>
          <p>
            Gmail remains the system of record and the place where messages are read and replied to.
          </p>
        </div>
        <div className="dm-story-boundary-node dm-story-boundary-allow">
          <span className="dm-story-step-label">Allowed across</span>
          <strong>{PRIVACY_STORAGE_LABEL}</strong>
          <ul>
            {PRIVACY_STORAGE_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="dm-story-boundary-node dm-story-boundary-stop">
          <span className="dm-story-step-label">Stopped at the boundary</span>
          <strong>{PRIVACY_NEVER_LABEL}</strong>
          <ul>
            {PRIVACY_NEVER_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="dm-story-figure-note">
        <strong>{PRIVACY_BADGE_HEADLINE}.</strong> “Gmail Preview” means Gmail&rsquo;s short preview
        text, not a full body.
      </p>
    </figure>
  );
}

export function ActionLifecycleFigure() {
  const steps = [
    ['Intent', 'You choose a manual action or approve an Observe-mode suggestion.'],
    ['Sheet', 'The optional preference sheet gathers scope and choices.'],
    ['Preview', 'A current count and available sample must load before confirmation.'],
    ['Execute', 'The server dispatches the Gmail mutation or unsubscribe request.'],
    ['Activity', 'The UI records the result returned by the relevant external boundary.'],
    ['Undo', 'A reversible Gmail mutation keeps its plan-defined undo path.'],
  ] as const;
  return (
    <figure className="dm-story-figure" aria-labelledby="dm-story-lifecycle-title">
      <figcaption id="dm-story-lifecycle-title">Manual action lifecycle</figcaption>
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
        Gmail confirms label mutations. A sender&rsquo;s list endpoint reports a one-click
        unsubscribe outcome. The delivered unsubscribe request cannot be undone; any paired Archive
        has its own reversible record. Active Pro Autopilot follows the separate rule path below and
        does not ask for per-message confirmation.
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
          <span className="dm-story-step-label">Pro</span>
          <h3>Autopilot preset rule</h3>
          <p>
            A preset starts in Observe, records what it would match, and acts on future matches only
            after you deliberately switch it to Active. It can be paused again.
          </p>
        </div>
      </div>
    </figure>
  );
}

export function RecommendationCascadeFigure() {
  const steps = [
    [
      'User agency first',
      'A Protect or VIP choice wins first. Reply, star, and long-term engagement signals also bias toward Keep.',
    ],
    [
      'Enough evidence?',
      'Very new or low-volume senders become Later instead of forcing a high-confidence choice.',
    ],
    [
      'Compare safe options',
      'Archive and Unsubscribe are scored from metadata facts such as volume, read rate, prior archives, and a sender-declared unsubscribe channel.',
    ],
    [
      'Show the reasoning',
      'The verdict, confidence, and inspectable facts reach the UI. The user makes the decision.',
    ],
  ] as const;

  return (
    <figure className="dm-story-figure" aria-labelledby="dm-story-recommendation-title">
      <figcaption id="dm-story-recommendation-title">
        Deterministic recommendation cascade
      </figcaption>
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
        Gmail&rsquo;s own label and only one transparent input to the cascade.
      </p>
    </figure>
  );
}
