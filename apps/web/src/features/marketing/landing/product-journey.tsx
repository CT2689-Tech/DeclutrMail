import Link from 'next/link';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

/** Static, labeled example of the production workspace. Live decisions belong to the simulator. */
export function ProductJourney() {
  return (
    <section className="dm-mkt-journey dm-mkt-shell" aria-labelledby="product-journey-title">
      <div className="dm-mkt-journey-heading">
        <p className="dm-mkt-journey-kicker">From first review to a recorded result</p>
        <h2 id="product-journey-title" className="dm-mkt-h2">
          See the sender. <em>Keep the context.</em>
        </h2>
        <p className="dm-mkt-lede">
          Your workspace starts with Overview. Open Clean up to review your senders and the email
          each decision would affect.
        </p>
      </div>
      <figure className="dm-mkt-workspace-example">
        <div className="dm-mkt-workspace-heading">
          <strong>
            Senders <em>/ Make room.</em>
          </strong>
          <span>Illustrative workspace · made-up data</span>
        </div>
        <div className="dm-mkt-workspace-grid">
          <div className="dm-mkt-sample-list">
            <p className="dm-mkt-sample-label">Your senders</p>
            <div className="dm-mkt-sample-row dm-mkt-sample-row-selected">
              <span className="dm-mkt-sample-avatar">in</span>
              <div>
                <strong>LinkedIn Updates</strong>
                <small>128 currently in inbox</small>
              </div>
              <span>
                64<small>last 90 days</small>
              </span>
            </div>
            <div className="dm-mkt-sample-row">
              <span className="dm-mkt-sample-avatar">M</span>
              <div>
                <strong>Medium Daily Digest</strong>
                <small>86 currently in inbox</small>
              </div>
              <span>
                42<small>last 90 days</small>
              </span>
            </div>
            <div className="dm-mkt-sample-row">
              <span className="dm-mkt-sample-avatar">G</span>
              <div>
                <strong>Groupon</strong>
                <small>23 currently in inbox</small>
              </div>
              <span>
                18<small>last 90 days</small>
              </span>
            </div>
            <p className="dm-mkt-sample-note">
              Search, filter and select senders. Review one at a time or preview a batch.
            </p>
          </div>
          <div className="dm-mkt-sample-inspector">
            <p className="dm-mkt-sample-label">Sender details</p>
            <div className="dm-mkt-sample-identity">
              <span className="dm-mkt-sample-avatar">in</span>
              <div>
                <h3>LinkedIn Updates</h3>
                <small>updates@example.com · sample sender</small>
              </div>
            </div>
            <dl className="dm-mkt-sample-metrics">
              <div>
                <dt>Currently in inbox</dt>
                <dd>128</dd>
              </div>
              <div>
                <dt>Received · last 90 days</dt>
                <dd>64</dd>
              </div>
            </dl>
            <p className="dm-mkt-sample-note">
              Marked-read flags and recent subjects give you context. They do not prove an email was
              read.
            </p>
            <div className="dm-mkt-sample-preview">
              <strong>Archive 128 emails?</strong>
              <p>
                These emails leave Inbox and stay in Gmail All Mail. This does not create a rule for
                future email.
              </p>
              <span>Activity Undo available for {MIN_UNDO_WINDOW_DAYS} days.</span>
            </div>
            <p className="dm-mkt-sample-verbs">Keep · Archive · Unsubscribe · Later · Delete</p>
            <Link className="dm-mkt-journey-link" href="/inbox-simulator?step=1">
              Try a review with sample mail →
            </Link>
          </div>
        </div>
        <figcaption>
          Example layout, not your mailbox. The interactive demo uses a separate made-up daily
          review queue.
        </figcaption>
      </figure>
      <ol className="dm-mkt-journey-steps">
        <li>
          <strong>1. Find your next step</strong>
          <p>Overview shows recorded progress and available review work.</p>
        </li>
        <li>
          <strong>2. Inspect and decide</strong>
          <p>
            Senders opens a detail inspector. Triage offers a focused daily review. Keep is an
            inline decision; mail-moving actions wait for a preview and confirmation.
          </p>
        </li>
        <li>
          <strong>3. Check the result</strong>
          <p>
            Activity records the outcome and available Undo. Delivered unsubscribe requests cannot
            be recalled.
          </p>
        </li>
        <li>
          <strong>4. Choose what repeats</strong>
          <p>
            Autopilot rules are separate. Preview a rule, choose Watch first or turn it on, and
            pause it whenever you need.
          </p>
        </li>
      </ol>
    </section>
  );
}
