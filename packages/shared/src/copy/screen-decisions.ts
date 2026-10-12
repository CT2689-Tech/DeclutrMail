/**
 * Launch decision constants. WS2 owns this file after the WS1a stub
 * commit. Each value is the default Chintan can flip in one line.
 */
import deck from './launch/deck/ws2.json' with { type: 'json' };

export const NAV_GROUP_LABEL = 'Cleanup'; // DECISION: Chintan
export const CONNECTION_TERM = 'Gmail account'; // DECISION: Chintan
export const CONNECTION_TERM_PLURAL = 'Gmail accounts'; // DECISION: Chintan
export const BRIEF_NAME = 'Daily Brief'; // DECISION: Chintan
export const BILLING_NAME = 'Plan & billing'; // DECISION: Chintan
export const KICKER_STYLE = 'group_only'; // DECISION: Chintan
export const PRO_WAITLIST_CONTACT_PROMISE = false; // DECISION: Chintan
export const SETTINGS_BRIEF_CARD = 'hide'; // DECISION: Chintan
export const LOCKED_PLUS_PRIMARY = 'plus'; // DECISION: Chintan
export const HOME_NEXT_STEPS_LABEL = 'Suggested next steps'; // DECISION: Chintan
export const FINISH_LABEL = 'Finish review'; // DECISION: Chintan
export const TRIAGE_NAME = 'Triage'; // DECISION: Chintan
export const SCREENER_NAME = 'Screener'; // DECISION: Chintan
export const BACKLOG_PASS_NAME = 'Backlog Pass'; // DECISION: Chintan
export const CATCH_UP_GROUP = 'keep'; // DECISION: Chintan
export const SETTINGS_PREVIEWS_TITLE = 'Preview layout'; // DECISION: Chintan
export const REPORT_TRUST_LINE_WRITTEN_TO = true; // DECISION: Chintan
export const PRO_PURCHASABLE = false; // DECISION: Chintan
export const CATCH_UP_LATER_FIRST = true; // DECISION: Chintan
export const FIRST_LANDING_SLOT_ORDER = [
  'inbox_report',
  'first_backlog_header',
  'first_cleanup_nudge',
] as const; // DECISION: Chintan
export const SHOW_SCREENER_NEW_SENDER_COUNT_FREE = true; // DECISION: Chintan
export const SHOW_SWEEPER_VENDOR_NAME = true; // DECISION: Chintan
export const PROVIDER_WAITLIST_CONTACT = 'opt_in'; // DECISION: Chintan

/** Consent card + stored version. A mismatch re-asks and treats AI as off. */
export const AI_CONSENT_VERSION = '2026-10'; // DECISION: Chintan
export const BRIEF_AI_CONSENT_VERSION = AI_CONSENT_VERSION;
/** One Settings toggle. Alternate true splits explanations and Brief. */
export const AI_SETTINGS_SPLIT = false; // DECISION: Chintan
/** Recommended training sentence, not the anthropic_terms alternate. */
export const AI_TRAINING_LINE = 'recommended' as const; // DECISION: Chintan
/** Recommended plain-explain rewrite. Alternate is the old template. */
export const PLAIN_EXPLAIN_COPY = 'recommended' as const; // DECISION: Chintan
export const AI_PROMPT_INTERVAL_DAYS = 30; // DECISION: Chintan
export const AI_PROMPT_MAX_DISMISSALS = 2; // DECISION: Chintan
export const EXPLAIN_AI_DISCLOSURE = deck.aiConsent.explain.sends;
export const BRIEF_AI_DISCLOSURE = deck.aiConsent.brief.sends;
