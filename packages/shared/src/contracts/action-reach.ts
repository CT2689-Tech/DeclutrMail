/**
 * ADR-0028 — how far a sender action reaches.
 *
 * Zero-server-dep mirror of `@declutrmail/db`'s `SenderActionReach`
 * (the `action_reach` pg enum), following the `ActionJobStatus` mirror
 * pattern: the API asserts the two stay identical at compile time, and
 * the web client imports THIS spelling so FE and BE cannot drift.
 *
 * `inbox_only` — messages currently carrying INBOX (every verb's
 * original semantic, and the wire default when the field is absent).
 * `all_mail` — inbox + archived (TRASH/SPAM/DRAFT/CHAT excluded);
 * legal only on a single-sender Delete primary.
 */
export const ACTION_REACHES = ['inbox_only', 'all_mail'] as const;
export type ActionReach = (typeof ACTION_REACHES)[number];
