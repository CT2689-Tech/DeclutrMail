import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';
import { ACTION_REGISTRY, VERB_REGISTRY, type VerbId } from '@declutrmail/shared/actions';
import { MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

/*
 * Product vignettes are drawn in HTML/CSS with the app's own tokens.
 * Every sender name and count below is made up and labelled as such.
 */

// One number for the whole ladder since 2026-08-23 (undo is uniform).
// Reduced across tiers rather than pinned, so if the windows ever diverge
// again this renders the FLOOR instead of a stale split.
const UNDO_DAYS = MIN_UNDO_WINDOW_DAYS;

/** Plans that include Autopilot, read from the tier manifest. */
const AUTOPILOT_PLANS = Object.values(TIER_MANIFEST)
  .filter((tier) => tier.purchasable && tier.capabilities.includes('autopilot'))
  .map((tier) => tier.name)
  .join(' and ');

const HERO_SENDERS = [
  { initial: 'D', name: 'Daily Deals', count: 212, verb: 'Unsubscribe' },
  { initial: 'L', name: 'LinkedIn Updates', count: 47, verb: 'Archive' },
  { initial: 'W', name: 'Weekly Digest', count: 38, verb: 'Later' },
  { initial: 'S', name: 'Shipping Alerts', count: 26, verb: 'Archive' },
] as const;

export function HeroSendersFigure() {
  return (
    <figure className="dm-story-device" aria-labelledby="dm-story-hero-visual-title">
      <div className="dm-story-device-bar">
        <strong>Senders</strong>
        <span>Most email first</span>
      </div>
      <ul className="dm-story-senders">
        {HERO_SENDERS.map((sender) => (
          <li key={sender.name}>
            <span className="dm-story-avatar" aria-hidden="true">
              {sender.initial}
            </span>
            <span className="dm-story-sender-name">{sender.name}</span>
            <span className="dm-story-sender-count">{sender.count} emails</span>
            <span className="dm-story-pill">{sender.verb}</span>
          </li>
        ))}
        <li className="dm-story-sender-protected">
          <span className="dm-story-avatar" aria-hidden="true">
            M
          </span>
          <span className="dm-story-sender-name">Maya Chen</span>
          <span className="dm-story-sender-count">9 emails</span>
          <span className="dm-story-pill dm-story-pill-quiet">Protected</span>
        </li>
      </ul>
      <figcaption id="dm-story-hero-visual-title">
        Illustrative inbox — made-up senders and counts
      </figcaption>
    </figure>
  );
}

const DECISION_VERBS = [
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
] as const satisfies readonly VerbId[];

/** One sender, the reason for the suggestion, and the five decisions. */
export function SenderDecisionFigure() {
  return (
    <figure className="dm-story-vignette" aria-labelledby="dm-story-decision-title">
      <div className="dm-story-device dm-story-decision">
        <div className="dm-story-decision-head">
          <span className="dm-story-avatar" aria-hidden="true">
            L
          </span>
          <div>
            <strong>LinkedIn Updates</strong>
            <span>47 inbox messages, 8% read</span>
          </div>
        </div>
        <p className="dm-story-decision-why">
          Archive is suggested because of the volume and low read rate.
        </p>
        <div className="dm-story-verbs">
          {DECISION_VERBS.map((id) => {
            const verb = VERB_REGISTRY.find((entry) => entry.id === id);
            if (!verb) return null;
            return (
              <span
                key={id}
                className={
                  id === 'archive' ? 'dm-story-verb dm-story-verb-suggested' : 'dm-story-verb'
                }
              >
                {ACTION_REGISTRY[id].copy.primary}
                <kbd>{verb.shortcut}</kbd>
              </span>
            );
          })}
        </div>
      </div>
      <figcaption id="dm-story-decision-title">
        Made-up walkthrough — sample sender and counts, never a real mailbox
      </figcaption>
    </figure>
  );
}

/** The five decisions in Gmail terms — the page's one table of verb semantics. */
export function DecisionsTable() {
  const row = (id: VerbId) => {
    const verb = VERB_REGISTRY.find((entry) => entry.id === id);
    return (
      <th scope="row">
        <span className="dm-story-verb-cell">
          {ACTION_REGISTRY[id].copy.primary}
          {verb ? <kbd>{verb.shortcut}</kbd> : null}
        </span>
      </th>
    );
  };
  const futureUnchanged = 'Unchanged, unless you turn on an Autopilot rule.';
  return (
    <div
      className="dm-story-table-wrap"
      role="region"
      tabIndex={0}
      aria-labelledby="dm-story-gmail-table-title"
    >
      <table className="dm-story-table">
        <caption id="dm-story-gmail-table-title" className="dm-story-sr-only">
          How each DeclutrMail decision maps to Gmail
        </caption>
        <thead>
          <tr>
            <th scope="col">Decision</th>
            <th scope="col">What changes in Gmail</th>
            <th scope="col">Future email</th>
            <th scope="col">Undo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {row('keep')}
            <td data-label="What changes in Gmail">Nothing. Your decision is recorded.</td>
            <td data-label="Future email">
              The sender stops coming up in Triage. Keep is not Protect: only Protect keeps a sender
              out of bulk and automatic changes.
            </td>
            <td data-label="Undo">Change the decision any time.</td>
          </tr>
          <tr>
            {row('archive')}
            <td data-label="What changes in Gmail">
              The previewed emails leave Inbox and stay in All Mail.
            </td>
            <td data-label="Future email">{futureUnchanged}</td>
            <td data-label="Undo">{UNDO_DAYS} days, on every plan.</td>
          </tr>
          <tr>
            {row('unsubscribe')}
            <td data-label="What changes in Gmail">
              Sends the sender&rsquo;s one-click request, or prepares a Gmail draft for you to send.
              Existing email stays where it is.
            </td>
            <td data-label="Future email">
              The sender may stop mailing once it accepts the request.
            </td>
            <td data-label="Undo">A sent request cannot be undone.</td>
          </tr>
          <tr>
            {row('later')}
            <td data-label="What changes in Gmail">
              The previewed emails leave Inbox for DeclutrMail/Later until the return time you
              choose.
            </td>
            <td data-label="Future email">{futureUnchanged}</td>
            <td data-label="Undo">{UNDO_DAYS} days, on every plan.</td>
          </tr>
          <tr>
            {row('delete')}
            <td data-label="What changes in Gmail">The previewed emails move to Gmail Trash.</td>
            <td data-label="Future email">{futureUnchanged}</td>
            <td data-label="Undo">
              {UNDO_DAYS} days from Activity. Gmail Trash is a separate fallback, normally up to 30
              days unless emptied sooner.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The confirm card: a question, one sentence, one button. */
export function ConfirmCardFigure() {
  return (
    <figure className="dm-story-vignette" aria-labelledby="dm-story-confirm-title">
      <div className="dm-story-confirm" aria-hidden="true">
        <p className="dm-story-confirm-title">Archive 47 emails?</p>
        <p>From LinkedIn Updates. They leave your inbox and stay in Gmail.</p>
        <span className="dm-story-button dm-story-button-primary">Archive 47</span>
      </div>
      <figcaption id="dm-story-confirm-title">
        Made-up preview. Once Gmail confirms, the change is recorded in Activity with Undo for{' '}
        {UNDO_DAYS} days on every plan.
      </figcaption>
    </figure>
  );
}

export function ActionLifecycleFigure() {
  const steps = [
    [
      'Choose',
      'Pick an action or approve a suggested batch. Some actions ask for a time range or return time first.',
    ],
    ['Preview', 'See the current number of affected emails, and a sample when available.'],
    ['Confirm', 'DeclutrMail makes the Gmail change or sends the unsubscribe request.'],
    ['Activity', 'The result appears after Gmail or the sender confirms it.'],
    ['Undo', 'Reverse Archive, Later, or Delete until the deadline shown in Activity.'],
  ] as const;
  return (
    <figure className="dm-story-steps-figure" aria-labelledby="dm-story-lifecycle-title">
      <figcaption id="dm-story-lifecycle-title">What happens when you confirm an action</figcaption>
      <ol className="dm-story-steps">
        {steps.map(([title, body]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{body}</span>
          </li>
        ))}
      </ol>
      <p className="dm-story-note">
        For one-click lists, the sender&rsquo;s system reports whether it accepted the request. A
        delivered unsubscribe request cannot be undone; a paired Archive has its own Undo.
      </p>
    </figure>
  );
}

export function AutomationBoundaryFigure() {
  return (
    <figure className="dm-story-split-figure" aria-labelledby="dm-story-automation-title">
      <figcaption id="dm-story-automation-title" className="dm-story-sr-only">
        Manual decisions and future automation are separate
      </figcaption>
      <div className="dm-story-split">
        <div>
          <h3>Manual cleanup</h3>
          <p className="dm-story-plan">Every plan</p>
          <p>
            Archive, Later, and Delete act on the current messages named in the preview. They do not
            quietly turn into rules for future mail.
          </p>
        </div>
        <div>
          <h3>Autopilot rules</h3>
          <p className="dm-story-plan">{AUTOPILOT_PLANS}</p>
          <p>
            Turning a preset on shows what it would do first, then it acts on future matches. Choose
            Watch first instead and it records what it would match, without moving mail, for your
            approval. You can pause it again.
          </p>
        </div>
      </div>
    </figure>
  );
}

export function DataBoundaryFigure() {
  return (
    <figure className="dm-story-split-figure" aria-labelledby="dm-story-data-title">
      <figcaption id="dm-story-data-title" className="dm-story-sr-only">
        What DeclutrMail stores from Gmail
      </figcaption>
      <div className="dm-story-split dm-story-split-lists">
        <div>
          <h3>{PRIVACY_STORAGE_LABEL}</h3>
          <ul>
            {PRIVACY_STORAGE_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>{PRIVACY_NEVER_LABEL}</h3>
          <ul>
            {PRIVACY_NEVER_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="dm-story-callout">
        <strong>{PRIVACY_BADGE_HEADLINE}</strong> Gmail remains where messages are read and replied
        to.
      </p>
    </figure>
  );
}

export function RecommendationCascadeFigure() {
  const steps = [
    [
      'Protected senders first',
      'A sender you protect is excluded. Writing to a sender, starring their email, or Gmail marking it important can also protect a sender automatically.',
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
    <figure className="dm-story-steps-figure" aria-labelledby="dm-story-recommendation-title">
      <figcaption id="dm-story-recommendation-title">How DeclutrMail suggests an action</figcaption>
      <ol className="dm-story-steps">
        {steps.map(([title, body]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{body}</span>
          </li>
        ))}
      </ol>
      <p className="dm-story-note">
        DeclutrMail does not predict email categories. When a Gmail category is present, it is
        Gmail&rsquo;s own label and only one of the facts DeclutrMail considers.
      </p>
    </figure>
  );
}
