'use client';

import { useState } from 'react';

import { TrackedCta } from './tracked-cta';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

interface LedgerVerb {
  id: string;
  shortcut: string;
  label: string;
}

/**
 * A short, replayable proof of the sender → preview → Activity loop.
 * The public simulator owns real interaction; this card stays focused
 * on making the mechanism understandable from the landing-page hero.
 */
export function LedgerDemo({ verbs }: { verbs: readonly LedgerVerb[] }) {
  const [runId, setRunId] = useState(0);
  const [paused, setPaused] = useState(false);
  const [complete, setComplete] = useState(false);

  const replay = () => {
    setPaused(false);
    setComplete(false);
    setRunId((current) => current + 1);
  };

  return (
    <div className="dm-mkt-ledger-demo">
      <div
        key={runId}
        className="dm-mkt-ledger"
        data-paused={paused ? 'true' : 'false'}
        data-run={runId}
        role="img"
        aria-label="Demo: archiving LinkedIn Notifications. 412 messages leave Inbox, remain searchable in All Mail, affect existing email only, and can be undone in Activity."
      >
        <div className="dm-mkt-ledger-head">
          <span>
            <span className="dm-mkt-ledger-dot" aria-hidden="true" />
            Sender review — decision 1 of 14
          </span>
          <span>this week</span>
        </div>
        <div className="dm-mkt-ledger-body">
          <div className="dm-mkt-ledger-row">
            <div className="dm-mkt-ledger-sender">
              <span className="dm-mkt-ledger-avatar" aria-hidden="true">
                in
              </span>
              <span>
                <span className="dm-mkt-ledger-name">LinkedIn Notifications</span>
                <span className="dm-mkt-ledger-meta">47/mo · 0 marked read in 90 days</span>
              </span>
            </div>
            <div className="dm-mkt-ledger-verbs">
              {verbs.map((verb) => (
                <span
                  key={verb.id}
                  className={`dm-mkt-ledger-verb${
                    verb.id === 'archive' ? ' dm-mkt-ledger-verb-archive' : ''
                  }`}
                >
                  <kbd>{verb.shortcut}</kbd>
                  {verb.label}
                </span>
              ))}
            </div>
            <div className="dm-mkt-ledger-preview">
              <b>Preview</b>
              <span>412 messages → All Mail</span>
              <span>Existing email only · Undo in Activity</span>
            </div>
          </div>
          <div
            className="dm-mkt-ledger-receipt"
            aria-hidden="true"
            onAnimationEnd={() => setComplete(true)}
          >
            <span className="dm-mkt-ledger-receipt-mark">✓</span>
            <b>412 messages archived from Inbox</b>
            <span>Still searchable in All Mail · existing email only</span>
          </div>
        </div>
        <div className="dm-mkt-ledger-toast">
          <span>
            <b>Archived — LinkedIn Notifications</b> · 412 messages
          </span>
          <span className="dm-mkt-undo">Undo in Activity</span>
        </div>
      </div>
      <div className="dm-mkt-ledger-controls" aria-label="Demo controls">
        {complete ? null : (
          <button
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused((current) => !current)}
          >
            {paused ? 'Resume demo' : 'Pause demo'}
          </button>
        )}
        <button type="button" onClick={replay}>
          Replay
        </button>
        <TrackedCta href="/inbox-simulator" cta="try_demo" placement="hero">
          Try this decision →
        </TrackedCta>
      </div>
      <p className="dm-mkt-ledger-caption">
        one Archive decision · 412 emails · undoable for {MIN_UNDO_WINDOW_DAYS} days
      </p>
    </div>
  );
}
