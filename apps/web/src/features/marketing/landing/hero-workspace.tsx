import './hero-workspace.css';

/** A labelled, static view of the real sender-list + right-inspector pattern. */
const SENDERS = [
  { initials: 'fn', name: 'Fieldnotes', note: '46 in 90 days', received: 389, color: '#8b4e32' },
  { initials: 'o', name: 'Orbit', note: '38 in 90 days', received: 276, color: '#5e649d' },
  { initials: 'w', name: 'Wayfinder', note: '28 in 90 days', received: 214, color: '#426b5c' },
  { initials: 'n', name: 'Northbank', note: 'Protected', received: 168, color: '#305775' },
] as const;

export function HeroWorkspace() {
  return (
    <figure
      className="dm-mkt-hero-workspace-figure"
      aria-labelledby="dm-mkt-hero-workspace-caption"
    >
      <div
        className="dm-mkt-hero-workspace"
        role="img"
        aria-label="Illustrative DeclutrMail workspace with a sender list and a right-hand detail inspector. Fieldnotes has 128 emails in Inbox, 46 received in the last 90 days, and archive and unsubscribe preview options. Fictional data."
      >
        <div aria-hidden="true">
          <div className="dm-mkt-hero-window-bar">
            <span className="dm-mkt-hero-window-dots">
              <i />
              <i />
              <i />
            </span>
            <span>DeclutrMail / Clean up</span>
            <span>ILLUSTRATIVE WORKSPACE</span>
          </div>
          <div className="dm-mkt-hero-workspace-body">
            <div className="dm-mkt-hero-workspace-rail">
              <span className="dm-mkt-hero-workspace-monogram">
                d<span>.</span>
              </span>
              <span>▦</span>
              <span className="dm-mkt-hero-workspace-rail-active">✦</span>
              <span>◷</span>
            </div>
            <div className="dm-mkt-hero-workspace-list">
              <p className="dm-mkt-hero-workspace-kicker">CLEAN UP · SENDERS</p>
              <h3>
                See who fills
                <br />
                your inbox.
              </h3>
              <div className="dm-mkt-hero-workspace-search">
                ⌕ <span>Search senders</span>
              </div>
              <div className="dm-mkt-hero-workspace-filters">
                <b>Active</b>
                <span>Filter</span>
                <span>Sort: Most received</span>
              </div>
              <div className="dm-mkt-hero-workspace-rows">
                {SENDERS.map((sender, index) => (
                  <div
                    key={sender.name}
                    className={index === 0 ? 'dm-mkt-hero-workspace-row-on' : ''}
                  >
                    <span
                      className="dm-mkt-hero-workspace-avatar"
                      style={{ background: sender.color }}
                    >
                      {sender.initials}
                    </span>
                    <span className="dm-mkt-hero-workspace-name">
                      <strong>{sender.name}</strong>
                      <small>{sender.note}</small>
                    </span>
                    <span>{sender.received}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="dm-mkt-hero-workspace-detail">
              <div className="dm-mkt-hero-workspace-detail-top">
                <span>SENDER DETAILS</span>
                <span>01 / 04</span>
              </div>
              <span className="dm-mkt-hero-workspace-profile-avatar">fn</span>
              <h3>Fieldnotes</h3>
              <p>weekly@fieldnotes.example</p>
              <div className="dm-mkt-hero-workspace-metrics">
                <span>
                  <strong>128</strong>
                  <small>in inbox</small>
                </span>
                <span>
                  <strong>46</strong>
                  <small>last 90 days</small>
                </span>
                <span>
                  <strong>8%</strong>
                  <small>marked read</small>
                </span>
              </div>
              <div className="dm-mkt-hero-workspace-messages">
                <span>RECENT EMAIL</span>
                <div>
                  <strong>Small ideas for a slower Sunday</strong>
                  <small>Today</small>
                </div>
                <div>
                  <strong>The art of doing a little less</strong>
                  <small>Sep 18</small>
                </div>
              </div>
              <div className="dm-mkt-hero-workspace-actions">
                <span>Preview archive</span>
                <span>Unsubscribe options ↗</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption id="dm-mkt-hero-workspace-caption" className="dm-mkt-hero-workspace-caption">
        01 / Your inbox by sender <span>Fictional sample</span>
      </figcaption>
    </figure>
  );
}
