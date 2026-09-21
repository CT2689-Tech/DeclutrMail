import type { CSSProperties } from 'react';

/**
 * The hero's signature moment: a column of emails collapses into the
 * senders that sent them, then one sender's confirm card rises.
 *
 * Pure CSS, zero client JS, one timeline that runs ONCE and ends well
 * under five seconds — WCAG 2.2.2 needs a pause control only for motion
 * that auto-plays longer than that (`landing-motion.test.ts` pins it).
 *
 * The BASE styles are the final frame; the keyframes only describe where
 * each piece comes from. So `prefers-reduced-motion` (animation: none)
 * and any renderer that skips animation show the settled result: three
 * senders and the confirm card.
 *
 * Everything here is illustrative — sender names, subjects and counts are
 * a sample, and the figcaption says so. The confirm card mirrors what a
 * preview owes the user (CLAUDE.md §2.3): the count and where email goes.
 */

const SENDERS = [
  { name: 'LinkedIn', initial: 'in', count: 412 },
  { name: 'Medium Daily Digest', initial: 'M', count: 186 },
  { name: 'Groupon', initial: 'G', count: 97 },
] as const;

/** Ten sample emails; `from` indexes SENDERS. Interleaved like a real inbox. */
const EMAILS = [
  { from: 0, subject: 'You appeared in 14 searches this week' },
  { from: 1, subject: 'Stories picked for you today' },
  { from: 2, subject: 'Weekend deals near you' },
  { from: 0, subject: 'New jobs that match your profile' },
  { from: 2, subject: 'Last chance on this week’s offers' },
  { from: 0, subject: 'Sam reacted to your post' },
  { from: 1, subject: 'Top picks from your topics' },
  { from: 2, subject: 'Fresh deals, picked for you' },
  { from: 0, subject: 'Your weekly network update' },
  { from: 1, subject: 'Your daily digest is ready' },
] as const;

/** Row pitches in px — must match `.dm-mkt-inbox-mail` / `-sender` heights. */
const MAIL_ROW = 46;
const SENDER_ROW = 68;

/** How far an email row travels to land on its sender's row. */
function collapseOffset(index: number, from: number): string {
  const target = from * SENDER_ROW + (SENDER_ROW - MAIL_ROW) / 2;
  return `${target - index * MAIL_ROW}px`;
}

const featured = SENDERS[0];

export function InboxCollapse() {
  return (
    <figure className="dm-mkt-inbox-figure">
      <div
        className="dm-mkt-inbox"
        role="img"
        aria-label={`Illustrative inbox: ten emails group into three senders — ${SENDERS.map(
          (s) => `${s.name}, ${s.count} emails`,
        ).join('; ')}. A preview then asks: Archive ${featured.count} emails from ${
          featured.name
        }? They leave your inbox and stay in Gmail.`}
      >
        <div className="dm-mkt-inbox-bar" aria-hidden="true">
          <span className="dm-mkt-inbox-title">Inbox</span>
        </div>

        <div className="dm-mkt-inbox-stage" aria-hidden="true">
          <ul className="dm-mkt-inbox-mails">
            {EMAILS.map((email, index) => (
              <li
                key={email.subject}
                className="dm-mkt-inbox-mail"
                style={{ '--dm-dy': collapseOffset(index, email.from) } as CSSProperties}
              >
                <b>{SENDERS[email.from].name}</b>
                <span>{email.subject}</span>
              </li>
            ))}
          </ul>

          <ul className="dm-mkt-inbox-senders">
            {SENDERS.map((sender, index) => (
              <li
                key={sender.name}
                className={`dm-mkt-inbox-sender${index === 0 ? ' dm-mkt-inbox-sender-on' : ''}`}
              >
                <span className="dm-mkt-inbox-avatar">{sender.initial}</span>
                <b>{sender.name}</b>
                <span className="dm-mkt-inbox-count">{sender.count} emails</span>
              </li>
            ))}
          </ul>

          <div className="dm-mkt-inbox-confirm">
            <p className="dm-mkt-inbox-confirm-title">Archive {featured.count} emails?</p>
            <p className="dm-mkt-inbox-confirm-body">
              From {featured.name}. They leave your inbox and stay in Gmail.
            </p>
            <div className="dm-mkt-inbox-confirm-actions">
              <span className="dm-mkt-inbox-cancel">Cancel</span>
              <span className="dm-mkt-inbox-go">Archive {featured.count}</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="dm-mkt-inbox-caption">Illustrative inbox</figcaption>
    </figure>
  );
}
