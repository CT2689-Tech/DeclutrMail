import { SenderWalkthrough } from './sender-walkthrough';

/** A labeled Archive walkthrough. Decisions here do not affect a real mailbox. */
export function ProductJourney() {
  return (
    <section
      id="product-tour"
      className="dm-mkt-journey dm-mkt-shell"
      aria-labelledby="product-journey-title"
    >
      <div className="dm-mkt-journey-heading">
        <p className="dm-mkt-journey-kicker">Product tour</p>
        <h2 id="product-journey-title" className="dm-mkt-h2">
          See the sender. <em>Know what will change.</em>
        </h2>
        <p className="dm-mkt-lede">
          See recent subjects and inbox counts together. Review the matching count and planned Gmail
          changes before you confirm a move.
        </p>
        <p className="dm-mkt-sender-decisions">
          <span>Keep</span>
          <span>Archive</span>
          <span>Unsubscribe</span>
          <span>Later</span>
          <span>Delete</span>
        </p>
      </div>
      <div className="dm-mkt-workspace-example">
        <SenderWalkthrough id="homepage-cleanup" />
      </div>
    </section>
  );
}
