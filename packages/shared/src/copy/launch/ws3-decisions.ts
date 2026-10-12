/**
 * WS3 launch decisions. Each value is the default Chintan can flip in one line.
 * Recommended deck strings ship now. Alternates stay behind these constants.
 */

/** Flips the 16 consent-tagged strings. On since Chintan approved it with #985. */
export const AI_CONSENT_GATE_LIVE = true; // DECISION: Chintan

/** `ga` drops the footer "Open beta" link. `/beta` stays reachable. */
export const LAUNCH_STAGE = 'ga' as 'ga' | 'beta'; // DECISION: Chintan

/** Omit the prompt-injection claim until WS2a hardening is merged. */
export const SHOW_INJECTION_LINE = false; // DECISION: Chintan

export const HERO_KICKER = 'recommended' as 'recommended' | 'd250'; // DECISION: Chintan

export const TRUST_ROW_VARIANT = 'full' as 'full' | 'short'; // DECISION: Chintan

/**
 * `privacy` publishes privacy@declutrmail.com, the address already used
 * for vulnerability and privacy mail:
 * apps/web/src/app/(marketing)/privacy/page.tsx,
 * apps/web/src/app/(marketing)/contact/page.tsx,
 * apps/web/src/app/(marketing)/support-pages.test.tsx,
 * and deck key ws3.security.txtContact.
 * `security` stays unused until a security@ inbox is confirmed.
 */
export const SECURITY_CONTACT = 'privacy' as 'privacy' | 'security'; // DECISION: Chintan

export const HIW_H1 = 'recommended' as 'recommended' | 'current'; // DECISION: Chintan

/** false → dm_attr is Essential (first-party), the deck category. */
export const DM_ATTR_REQUIRES_CONSENT = false; // DECISION: Chintan

export const VS_FAQ_Q1_STYLE = 'recommended' as 'recommended' | 'spec'; // DECISION: Chintan

export const VS_FAQ_Q2_STYLE = 'recommended' as 'recommended' | 'glossary'; // DECISION: Chintan

/** Recommended: Anthropic sets its own terms. Not the commercial-terms alternate. */
export const BRIEF_TRAINING_LINE = 'recommended' as 'recommended' | 'commercial'; // DECISION: Chintan

/** Empty until real profiles exist. Omitted from JSON-LD while empty. */
export const ORGANIZATION_SAME_AS: readonly string[] = [];

/**
 * Distinct copy pieces that switch only when `AI_CONSENT_GATE_LIVE` is true.
 * `ws3.security.ai.intro` is not in this list: both AI uses are disclosed
 * with today's wording before the gate.
 */
export const AI_CONSENT_GATE_KEYS = [
  'ws3.security.ai.explanations',
  'ws3.security.ai.brief',
  'ws3.security.ai.control',
  'ws3.methodology.explanations',
  'ws3.privacy.ai.explanations',
  'ws3.privacy.ai.brief',
  'ws3.privacy.subprocessors.anthropic',
  'ws3.privacy.aiDisclosureConst',
  'ws3.llms.keyFacts',
  'ws3.vs.faq.privacy.a',
  'ws3.security.glance.lines',
  'ws3.privacy.ai.title',
  'ws3.privacy.ai.who',
  'ws3.privacy.ai.retention',
  'ws3.privacy.ai.training',
  'ws3.privacy.ai.humans',
] as const;
