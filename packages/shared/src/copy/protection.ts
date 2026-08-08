// @declutrmail/shared/copy/protection — the ONE place that says why a
// sender is Protected.
//
// CLAUDE.md §2.6 / D245 require the EXACT reason to be shown wherever
// protection is. Before this module four surfaces each owned a copy of
// that sentence — Screener (`protectionReasonLabel`), Triage
// (`protectionEvidence`), Sender Detail (an inline ternary in
// `header.tsx`) and the Settings policies list (which showed no reason
// at all). They had already drifted: the same automatic protection read
// as "you starred a message" on one screen and "Starred" on another,
// and the user-set case was "always kept" in Triage but "you marked it
// Protected" in the Screener.
//
// The wire spelling had drifted too. `sender_policies.protection_reason`
// is snake_case (`user_defined`, `gmail_important`), Screener and the
// senders wire type kept that, while Triage and Sender Detail invented a
// kebab variant (`user-marked`, `gmail-important`) and each adapted at
// their own boundary. `normalizeProtectionReason` accepts either, so a
// consumer never has to know which dialect its own feature speaks.
//
// PRIVACY (D7/D228): reason identifiers and UI strings only — no sender
// identity, no message content. Safe in the client bundle.

/**
 * Why automatic or manual protection is set, in the DB's own spelling
 * (`sender_policies.protection_reason`). This is the canonical union;
 * feature-local kebab variants are legacy aliases, not new facts.
 */
export type ProtectionReasonId = 'user_defined' | 'replied' | 'starred' | 'gmail_important';

/**
 * The two reasons that rest on a ONE-WAY signal (D245). A reply is a
 * two-way relationship and needs no second-guessing; a star or an
 * importance flag marks a message, not a correspondent.
 *
 * `user_defined` is in neither camp: the user said so.
 */
export const WEAK_PROTECTION_REASON_IDS = ['starred', 'gmail_important'] as const;

/** True when the protection rests on a single one-way signal. */
export function isWeakProtectionReason(reason: ProtectionReasonId | null): boolean {
  return reason === 'starred' || reason === 'gmail_important';
}

/**
 * Accept either dialect and return the canonical id.
 *
 * Unknown strings return `null` rather than guessing. An earlier
 * adapter defaulted anything unrecognized to "the user marked it",
 * which turns a new enum value into a false statement about the user's
 * own actions — the worst possible direction to be wrong in.
 */
export function normalizeProtectionReason(
  reason: string | null | undefined,
): ProtectionReasonId | null {
  switch (reason) {
    // Three spellings for one fact. `sender_policies.protection_reason`
    // says `user_defined`; Sender Detail's adapter invented
    // `user-marked`; and `TriageReadService` maps the same value to
    // `manual` on the Triage wire. All three are live, so all three
    // resolve here rather than at three different boundaries.
    case 'user_defined':
    case 'user-marked':
    case 'manual':
      return 'user_defined';
    case 'replied':
      return 'replied';
    case 'starred':
      return 'starred';
    case 'gmail_important':
    case 'gmail-important':
      return 'gmail_important';
    default:
      return null;
  }
}

/**
 * The reason as a clause that completes "…because {clause}" or stands
 * after "Protected · ". Lower-case, no trailing period, so a caller can
 * embed it either way.
 *
 * @example
 *   `Protected · ${protectionReasonClause('starred')}`
 *   // "Protected · you starred a message"
 */
export function protectionReasonClause(reason: ProtectionReasonId | null): string {
  switch (reason) {
    case 'user_defined':
      return 'you marked it Protected';
    case 'replied':
      return 'you replied at least 3 times';
    case 'starred':
      return 'you starred a message';
    case 'gmail_important':
      return 'Gmail marks it important';
    // Protected with no recorded reason is a real row shape (the CHECK
    // only binds reason when `is_protected`), so say the honest minimum
    // rather than inventing evidence.
    case null:
      return 'it is Protected';
  }
}

/** "Protected · you starred a message" — the row-level label. */
export function protectionReasonLabel(reason: ProtectionReasonId | null): string {
  return `Protected · ${protectionReasonClause(reason)}`;
}
