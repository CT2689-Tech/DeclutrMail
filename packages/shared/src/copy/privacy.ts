// @declutrmail/shared/copy/privacy — D7 + D228 locked privacy copy.
//
// This module is the single source of truth for trust-badge wording.
// Every product surface that shows the privacy posture (landing page,
// onboarding, Privacy & Data settings) MUST import from here so the
// `check-microcopy.sh --rule=privacy-badge` audit only has one file to
// guard.
//
// **Locked strings — do not edit without a new D-decision:**
// - "Full bodies fetched: 0"       (D228 headline; replaces the
//                                   pre-D228 "Bodies read: 0 forever"
//                                   which is BANNED in product UI.)
// - The exact storage allowlist    (D7 + D228 + CLAUDE.md §2.1):
//   sender (name + email), subject, Gmail's short snippet, dates,
//   Gmail labels, read/unread state.
// - "Gmail Preview" framing for    (D7 — snippet is the preview Gmail
//   the snippet field              already surfaces in the inbox list;
//                                   it is never called "summary" or
//                                   "body" in user-facing copy.)

/** The locked headline shown on every trust badge surface (D228). */
export const PRIVACY_BADGE_HEADLINE = 'Full bodies fetched: 0' as const;

/**
 * The exact items DeclutrMail stores per message (D7 + D228).
 *
 * Order matters — the badge enumerates them in this sequence so the
 * copy reads naturally ("sender, subject, Gmail Preview, dates, …").
 */
export const PRIVACY_STORAGE_ITEMS = [
  'Sender (name + email)',
  'Subject',
  'Gmail Preview (the short snippet shown in your inbox list)',
  'Dates (received)',
  'Gmail labels',
  'Read/unread state',
] as const;

/**
 * The exact items DeclutrMail never fetches or stores (D228 + CLAUDE.md §2.1).
 *
 * Mirrors the "never" half of the badge — the falsifiable boundary
 * that makes the trust claim defensible.
 */
export const PRIVACY_NEVER_ITEMS = [
  'Full message body',
  'HTML',
  'Attachments',
  'Inline images',
  'Raw MIME',
  'Headers other than the ones above',
] as const;

/** Supporting lead — explains what the headline means in plain words. */
export const PRIVACY_BADGE_LEAD =
  'We never fetch or store the body of your messages. Here is the exact list of what we do store, and what we do not.' as const;

/** Sub-label that introduces the storage list. */
export const PRIVACY_STORAGE_LABEL = 'We store:' as const;

/** Sub-label that introduces the never-stored list. */
export const PRIVACY_NEVER_LABEL = 'We never fetch or store:' as const;

/** The user-facing field label for the Gmail snippet (D7 framing). */
export const GMAIL_PREVIEW_FIELD_LABEL = 'Gmail Preview' as const;
