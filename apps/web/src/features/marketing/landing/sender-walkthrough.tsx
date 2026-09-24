import Link from 'next/link';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import './sender-walkthrough.css';

const STEPS = ['Inspect', 'Preview', 'Result', 'Undo'] as const;

/**
 * A deliberately labeled illustration of one supported Archive journey.
 * Native radio controls keep the walkthrough keyboard-operable without
 * shipping another client runtime or contacting an authenticated API.
 * `id` is provided by the host so two examples never share a radio group.
 */
export function SenderWalkthrough({
  id,
  showDemoLink = true,
}: {
  id: string;
  showDemoLink?: boolean;
}) {
  return (
    <fieldset className="dm-walkthrough" aria-describedby={`${id}-disclosure ${id}-undo`}>
      <legend>A cleanup, step by step</legend>
      <p id={`${id}-disclosure`} className="dm-walkthrough-note">
        Illustrative walkthrough · made-up data. Nothing changes in Gmail.
      </p>
      <div className="dm-walkthrough-steps">
        {STEPS.map((label, index) => (
          <label key={label}>
            <input
              type="radio"
              name={`${id}-step`}
              value={index + 1}
              defaultChecked={index === 0}
              aria-controls={`${id}-panel-${index + 1}`}
            />
            <span>
              {index + 1}. {label}
            </span>
          </label>
        ))}
      </div>
      <div className="dm-walkthrough-panels">
        <div id={`${id}-panel-1`} data-step="1" className="dm-walkthrough-panel">
          <p className="dm-walkthrough-eyebrow">Senders → Sender details</p>
          <h3>LinkedIn Updates</h3>
          <p className="dm-walkthrough-note">updates@example.com · sample sender</p>
          <dl>
            <div>
              <dt>Currently in inbox</dt>
              <dd>128</dd>
            </div>
            <div>
              <dt>Received · last 90 days</dt>
              <dd>64</dd>
            </div>
          </dl>
          <p>
            Open a sender beside the list. Check recent subjects and the email your decision would
            affect.
          </p>
          <p className="dm-walkthrough-note">
            Marked-read flags give context; they do not prove an email was read.
          </p>
        </div>
        <div id={`${id}-panel-2`} data-step="2" className="dm-walkthrough-panel">
          <p className="dm-walkthrough-eyebrow">Archive preview</p>
          <h3>Archive 128 emails?</h3>
          <dl>
            <div>
              <dt>Where</dt>
              <dd>Inbox only</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>All inbox email</dd>
            </div>
          </dl>
          <p>These emails leave Inbox and stay in Gmail All Mail.</p>
          <p className="dm-walkthrough-note">
            Review the current count before confirming. A one-time Archive does not create a future
            rule or free storage.
          </p>
        </div>
        <div id={`${id}-panel-3`} data-step="3" className="dm-walkthrough-panel">
          <p className="dm-walkthrough-eyebrow">Activity → Completed</p>
          <h3>128 emails archived</h3>
          <p>LinkedIn Updates · Archive</p>
          <p>
            Activity records the completed result. If an action is still running or needs attention,
            its status says so.
          </p>
          <p className="dm-walkthrough-note">
            Choose Undo from the recorded action while its recovery window is open.
          </p>
        </div>
        <div id={`${id}-panel-4`} data-step="4" className="dm-walkthrough-panel">
          <p className="dm-walkthrough-eyebrow">Activity → Undo complete</p>
          <h3>128 emails restored</h3>
          <p>In this example, the archived inbox email returns to Inbox.</p>
          <p className="dm-walkthrough-note">
            Undo applies to supported mail-moving actions. A delivered unsubscribe request cannot be
            recalled.
          </p>
        </div>
      </div>
      <p id={`${id}-undo`} className="dm-walkthrough-note">
        Archive, Later and Delete have {MIN_UNDO_WINDOW_DAYS} days of Activity Undo.
      </p>
      {showDemoLink ? (
        <Link className="dm-walkthrough-link" href="/inbox-simulator?workspace=senders">
          Try the Senders workspace →
        </Link>
      ) : null}
    </fieldset>
  );
}
