// @declutrmail/shared/copy/privacy — D7 + D228 + D245 privacy copy.
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
// - The cumulative storage list is generated from D245's typed registry.
// - "Gmail Preview" framing for    (D7 — snippet is the preview Gmail
//   the snippet field              already surfaces in the inbox list;
//                                   it is never called "summary" or
//                                   "body" in user-facing copy.)

import { GMAIL_MESSAGE_STORAGE_LABELS } from '../contracts/gmail-data-inventory';

/** The locked headline shown on every trust badge surface (D228). */
export const PRIVACY_BADGE_HEADLINE = 'Full bodies fetched: 0' as const;

/**
 * The cumulative items DeclutrMail stores per message (D245).
 * Generated from the lifecycle registry so adapter/schema amendments cannot
 * leave a hand-maintained public subset behind.
 */
export const PRIVACY_STORAGE_ITEMS = GMAIL_MESSAGE_STORAGE_LABELS;

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
  'Headers other than From, Subject, To, Cc, and List-Unsubscribe fields',
] as const;

/** Supporting lead — explains what the headline means in plain words. */
export const PRIVACY_BADGE_LEAD =
  'We never fetch or store message bodies. This list is generated from the Gmail fields DeclutrMail actually stores.' as const;

/** Sub-label that introduces the storage list. */
export const PRIVACY_STORAGE_LABEL = 'Message data we store:' as const;

/** Sub-label that introduces the never-stored list. */
export const PRIVACY_NEVER_LABEL = 'We never fetch or store:' as const;

/** The user-facing field label for the Gmail snippet (D7 framing). */
export const GMAIL_PREVIEW_FIELD_LABEL = 'Gmail Preview' as const;
