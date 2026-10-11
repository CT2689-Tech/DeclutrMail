/**
 * Fill WS3 deck tokens from WS1 formatters and shared constants.
 * Prices, plan names, and refund windows are never written as literals here.
 */

import { BRIEF_AI_DISCLOSURE, RECOMMENDATION_AI_DISCLOSURE } from '../action-safety';
import { GMAIL_DATA_PROCESSORS } from '../../contracts/gmail-data-inventory';
import {
  cleanupActionsPerMonthFor,
  planName,
  priceLine,
  refundLine,
  TIER_MANIFEST,
} from '../../entitlements';
import { hasLegalEntity, LEGAL_ENTITY_ADDRESS, LEGAL_ENTITY_NAME } from '../legal-entity';
import {
  BRAND_VERIFICATION_APPROVED_ON,
  CASA_LOV_SUBMITTED_ON,
  CASA_VERIFICATION_APPROVED_ON,
  formatVerificationDate,
} from '../privacy';
import { BRIEF_NAME } from '../screen-decisions';
import { AI_CONSENT_GATE_LIVE, HERO_KICKER, LAUNCH_STAGE, SECURITY_CONTACT } from './ws3-decisions';
import { WS3_COPY } from './ws3';

export function passListed(): boolean {
  return process.env.BILLING_PASS_ENABLED === 'true';
}

export function securityContactEmail(): string {
  if (SECURITY_CONTACT === 'security') return 'security@declutrmail.com';
  return WS3_COPY['ws3.security.txtContact'];
}

export function heroKicker(): string {
  if (HERO_KICKER === 'd250') return 'For inboxes you gave up on';
  return WS3_COPY['ws3.home.kicker'];
}

function allowanceToken(): string {
  const allowance = cleanupActionsPerMonthFor('free');
  return allowance == null ? '' : allowance.toLocaleString('en-US');
}

function plusPriceToken(): string {
  const annual = TIER_MANIFEST.plus.prices.annual;
  return annual ? priceLine(annual, 'usd') : '';
}

/** Tokens whose values come from formatters or constants, never from a typed price. */
export function ws3Tokens(extra?: Record<string, string>): Record<string, string> {
  return {
    allowance: allowanceToken(),
    OAUTH_DATE: formatVerificationDate(CASA_VERIFICATION_APPROVED_ON),
    CASA_LOV_DATE: formatVerificationDate(CASA_LOV_SUBMITTED_ON),
    BRAND_DATE: formatVerificationDate(BRAND_VERIFICATION_APPROVED_ON),
    freeName: planName('free'),
    plusName: planName('plus'),
    proName: planName('pro'),
    passName: planName('pass'),
    plusPrice: plusPriceToken(),
    // No pass price point or duration is exported yet. Leave blank rather than invent one.
    passPrice: '',
    passDays: '',
    refundDays: '',
    BRIEF_NAME,
    anthropicRetention: GMAIL_DATA_PROCESSORS.Anthropic.retention,
    legalEntity: hasLegalEntity() ? LEGAL_ENTITY_NAME : '',
    legalAddress: hasLegalEntity() ? LEGAL_ENTITY_ADDRESS : '',
    securityContact: securityContactEmail(),
    ...extra,
  };
}

export function fillWs3(template: string, extra?: Record<string, string>): string {
  const tokens = ws3Tokens(extra);
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => {
    const value = tokens[key];
    return value === undefined ? whole : value;
  });
}

/** The money-back line under a comparison CTA. Hidden when the formatter is still empty. */
export function refundSentence(): string {
  return refundLine();
}

export function declutrPriceSummary(): string {
  const template = passListed()
    ? WS3_COPY['ws3.vs.declutr.price.summary']
    : WS3_COPY['ws3.vs.declutr.price.summary'].replace(/ or a one-time \{passName\}/, '');
  return fillWs3(template);
}

export function declutrPriceDetail(): string {
  if (!passListed()) return fillWs3(WS3_COPY['ws3.vs.faq.price.a.passOff']);
  return fillWs3(WS3_COPY['ws3.vs.declutr.price.detail']);
}

const BEFORE_GATE: Record<string, string> = {
  'ws3.security.ai.explanations': RECOMMENDATION_AI_DISCLOSURE,
  'ws3.security.ai.brief': BRIEF_AI_DISCLOSURE,
  'ws3.security.ai.control': '',
  'ws3.methodology.explanations':
    'Anthropic may turn the selected sender facts into a short explanation. It receives the sender’s name and domain, the suggested action, and the facts behind it. It does not receive subject lines, preview snippets, or full email contents for this explanation. If Anthropic is unavailable, DeclutrMail shows a standard explanation.',
  'ws3.privacy.ai.explanations': RECOMMENDATION_AI_DISCLOSURE,
  'ws3.privacy.ai.brief': BRIEF_AI_DISCLOSURE,
  'ws3.privacy.subprocessors.anthropic':
    'Suggestion explanations and Pro Brief summaries. A Pro Brief can include the subject line and Gmail preview snippet, but never full email contents.',
  'ws3.privacy.aiDisclosureConst': `${RECOMMENDATION_AI_DISCLOSURE} ${BRIEF_AI_DISCLOSURE}`,
  'ws3.privacy.ai.who':
    'Suggestion explanations may send Anthropic the sender and engagement numbers. Pro Brief may send the sender, subject line, and Gmail preview snippet. Neither receives full email contents.',
  'ws3.privacy.ai.retention': GMAIL_DATA_PROCESSORS.Anthropic.retention,
  'ws3.privacy.ai.training':
    'We do not use Gmail data to train generalized AI or machine-learning models.',
  'ws3.privacy.ai.humans': '',
  'ws3.privacy.ai.title': 'AI processing',
};

export function gateOpen(): boolean {
  return AI_CONSENT_GATE_LIVE;
}

/** Deck string after the gate; today's wording before it. Empty means omit the line. */
export function gatedText(key: keyof typeof WS3_COPY): string {
  if (!AI_CONSENT_GATE_LIVE && key in BEFORE_GATE) return BEFORE_GATE[key] ?? '';
  const value = WS3_COPY[key];
  return typeof value === 'string' ? fillWs3(value) : '';
}

export function privacyFaqAnswer(): string {
  const full = fillWs3(WS3_COPY['ws3.vs.faq.privacy.a']);
  if (AI_CONSENT_GATE_LIVE) return full;
  const cut = full.split(' If you allow AI')[0] ?? full;
  return cut.endsWith('.') ? cut : `${cut}.`;
}

export function priceFaqAnswer(): string {
  const key = passListed() ? 'ws3.vs.faq.price.a' : 'ws3.vs.faq.price.a.passOff';
  const filled = fillWs3(WS3_COPY[key]);
  if (ws3Tokens().refundDays !== '') return filled;
  return filled.replace(/\s*-day money-back on any purchase, once per customer\./, '').trim();
}

export function llmsAutopilotLine(): string {
  return fillWs3(WS3_COPY['ws3.llms.fix.autopilot']);
}

export function llmsPricingLine(): string {
  const template = passListed()
    ? WS3_COPY['ws3.llms.fix.pricingLink']
    : WS3_COPY['ws3.llms.fix.pricingLink'].replace(' and the one-time {passName}', '');
  return fillWs3(template);
}

export function llmsBetaLine(): string {
  if (LAUNCH_STAGE === 'ga') return WS3_COPY['ws3.llms.fix.beta'];
  return 'Open beta: sign in with Google and review senders, no invite or waitlist needed';
}

/** Current llms.txt AI sentence. The deck bullet replaces it only after the gate. */
export const LLMS_AI_BEFORE_GATE =
  'Suggestion explanations may send Anthropic the sender and engagement numbers, but not subject lines or preview snippets. Pro Brief may send the sender, subject line, and Gmail preview snippet to Anthropic; it never sends full email contents.';

export function llmsKeyFacts(): readonly string[] {
  const facts = WS3_COPY['ws3.llms.keyFacts'];
  return facts.map((fact, index) => {
    if (index === 3 && !AI_CONSENT_GATE_LIVE) return LLMS_AI_BEFORE_GATE;
    if (index === 6) {
      return fillWs3(fact, { factsCheckedDate: 'October 11, 2026' });
    }
    return fillWs3(fact);
  });
}

export function glanceLines(): readonly string[] {
  return WS3_COPY['ws3.security.glance.lines'].flatMap((line, index) => {
    if (index === 2 && !AI_CONSENT_GATE_LIVE) return [];
    return [fillWs3(line)];
  });
}

export function showOpenBetaLink(): boolean {
  return LAUNCH_STAGE === 'beta';
}
