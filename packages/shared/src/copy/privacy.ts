// @declutrmail/shared/copy/privacy — D7 + D228 + D245 privacy copy.
//
// This module is the single source of truth for trust-badge wording.
// Every product surface that shows the privacy posture (landing page,
// onboarding, Privacy & Data settings) MUST import from here so the
// `check-microcopy.sh --rule=privacy-badge` audit only has one file to
// guard.
//
// **Locked strings — do not edit without a new D-decision:**
// - "We never fetch or store full email contents." (plain-language
//   replacement for the retired counter-style privacy headlines)
// - The cumulative storage list is generated from D245's typed registry.
// - "Gmail preview snippet" framing (D7 — snippet is the preview Gmail
//   already surfaces in the inbox list; it is never called a "summary"
//   or "body" in user-facing copy.)

import { GMAIL_MESSAGE_STORAGE_LABELS } from '../contracts/gmail-data-inventory';

/** The locked headline shown on every trust badge surface (D228). */
export const PRIVACY_BADGE_HEADLINE = 'We never fetch or store full email contents.' as const;

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
  'Full email contents',
  'Email HTML',
  'Attachments',
  'Images embedded in emails',
  'Raw email source',
  'Email headers other than From, Subject, To, Cc, and unsubscribe information',
] as const;

/** Supporting lead — explains what the headline means in plain words. */
export const PRIVACY_BADGE_LEAD = 'DeclutrMail uses only the Gmail details listed below.' as const;

/** Sub-label that introduces the storage list. */
export const PRIVACY_STORAGE_LABEL = 'Gmail details DeclutrMail stores:' as const;

/** Sub-label that introduces the never-stored list. */
export const PRIVACY_NEVER_LABEL = 'DeclutrMail never fetches or stores:' as const;

/** The user-facing field label for the Gmail snippet (D7 framing). */
export const GMAIL_PREVIEW_FIELD_LABEL = 'Gmail preview snippet' as const;

/**
 * Pre-consent disclosure rendered beside every CTA that starts Google OAuth.
 *
 * Public CTAs link straight to Google's consent screen, so this is the last
 * DeclutrMail-authored sentence a user reads before granting access — it
 * explains the permission in user language and carries the privacy promise.
 */
export const OAUTH_SCOPE_DISCLOSURE =
  `Google will ask permission for DeclutrMail to organize your Gmail. ${PRIVACY_BADGE_HEADLINE}` as const;

/**
 * The date Google approved DeclutrMail's OAuth verification for the single
 * restricted scope, under the CASA assessment.
 *
 * This is the product's only third-party credential, and before this
 * constant existed the date was hand-written on four separate surfaces
 * (`/privacy`, `/security`, Settings → Privacy & Data, and the landing
 * trust strip). Verification is recertified ANNUALLY, so a hand-copied
 * date is a claim that goes stale on a known schedule and updates only
 * where someone remembers to look.
 *
 * **The word is `approved`.** Google approved a verification; it did not
 * certify or audit the product. No surface may upgrade that.
 */
export const CASA_VERIFICATION_APPROVED_ON = '21 April 2026' as const;

/** Month-level form, for surfaces too narrow for the full date. */
export const CASA_VERIFICATION_APPROVED_MONTH = 'April 2026' as const;
