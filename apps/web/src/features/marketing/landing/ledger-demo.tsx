interface LedgerVerb {
  id: string;
  shortcut: string;
  label: string;
}

/**
 * The product loop in one glance: a sender, a decision, a result you can
 * undo. Three frames share one slot — the five decisions, the preview, the
 * result — so only one thing is on screen at a time.
 *
 * Pure CSS and no client JS. The timeline runs ONCE and is under five
 * seconds end to end, which is what lets it ship without Pause / Replay
 * controls: WCAG 2.2.2 only requires a pause mechanism for motion that
 * auto-plays for longer than that (`landing-motion.test.ts` pins the
 * ceiling). It settles on the result frame, which is also what the global
 * reduced-motion override shows immediately. The interactive version is the
 * public simulator, linked from the hero.
 */
export function LedgerDemo({ verbs }: { verbs: readonly LedgerVerb[] }) {
  return (
    <figure className="dm-mkt-ledger-demo">
      <div
        className="dm-mkt-ledger"
        role="img"
        aria-label="Example: archiving LinkedIn Notifications. The preview shows 412 emails leaving Inbox and staying in All Mail. After confirming, 412 emails are archived and Undo is available."
      >
        <div className="dm-mkt-ledger-sender">
          <span className="dm-mkt-ledger-avatar" aria-hidden="true">
            in
          </span>
          <span>
            <span className="dm-mkt-ledger-name">LinkedIn Notifications</span>
            <span className="dm-mkt-ledger-meta">47 emails a month</span>
          </span>
        </div>
        <div className="dm-mkt-ledger-stage">
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
            <span>412 emails leave Inbox. They stay in All Mail.</span>
          </div>
          <div className="dm-mkt-ledger-result">
            <span>
              <span aria-hidden="true">✓</span> 412 emails archived
            </span>
            <span className="dm-mkt-undo">Undo</span>
          </div>
        </div>
      </div>
      <figcaption className="dm-mkt-ledger-caption">An example decision.</figcaption>
    </figure>
  );
}
