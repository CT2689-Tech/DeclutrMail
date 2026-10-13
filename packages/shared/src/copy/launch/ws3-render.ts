/**
 * Fill WS3 deck tokens from WS1 formatters and shared constants.
 * Prices, plan names, and refund windows are never written as literals here.
 */

import { GMAIL_DATA_PROCESSORS } from '../../contracts/gmail-data-inventory';
import {
  isBillingPassEnabled,
  isPricingV2,
  METER,
  OFFERS,
  passAmount,
  planName,
  plusAmount,
  POLICY,
  priceLine,
  refundLine,
  renderPricingMarkdown,
  TIER_MANIFEST,
} from '../../entitlements';
import { hasLegalEntity, LEGAL_ENTITY_ADDRESS, LEGAL_ENTITY_NAME } from '../legal-entity';
import {
  BRAND_VERIFICATION_APPROVED_ON,
  CASA_LOV_SUBMITTED_ON,
  CASA_VERIFICATION_APPROVED_ON,
  formatVerificationDate,
} from '../privacy';
import { BRIEF_NAME, CONNECTION_TERM } from '../screen-decisions';
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
  return METER.free.limit.toLocaleString('en-US');
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
    refundDays: isPricingV2() ? String(POLICY.refundWindowDays) : '',
    BRIEF_NAME,
    CONNECTION_TERM,
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

function clauseIsComplete(clause: string, tokens: Record<string, string>): boolean {
  const keys = [...clause.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1] ?? '');
  return keys.every((key) => (tokens[key] ?? '') !== '');
}

/**
 * Fill a deck template, dropping any sentence or semicolon-clause that
 * still needs an empty filler. A half-filled price sentence is worse
 * than no sentence: `{plusName} is {plusPrice}` must not become " is ".
 */
export function fillComplete(template: string, extra?: Record<string, string>): string {
  const tokens = ws3Tokens(extra);
  const sentences = template.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const clauses = sentence.split(/;\s+/);
    const surviving = clauses.filter((clause) => clauseIsComplete(clause, tokens));
    if (surviving.length === 0) continue;
    let joined = surviving.join('; ');
    const terminal = sentence.match(/[.!?]$/)?.[0];
    if (terminal && !/[.!?]$/.test(joined)) joined = `${joined}${terminal}`;
    kept.push(fillWs3(joined, extra));
  }
  return kept
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Plan names and the Plus price are still empty until the WS1 catalog flips. */
function pricingCatalogReady(): boolean {
  const tokens = ws3Tokens();
  return tokens.freeName !== '' && tokens.plusName !== '' && tokens.plusPrice !== '';
}

/**
 * Launch amounts already live on the 2026-10 price points. Callers that
 * resolved `loadPricingFlags()` pass those booleans so a web process
 * whose own env is off still fills the existing v2 sentences.
 */
function launchTokenOverrides(
  pricingV2: boolean,
  passEnabled: boolean,
): Record<string, string> | undefined {
  if (!pricingV2) return undefined;
  return {
    plusPrice: plusAmount('usd'),
    allowance: METER.free.limit.toLocaleString('en-US'),
    refundDays: String(POLICY.refundWindowDays),
    ...(passEnabled
      ? {
          passPrice: passAmount('usd'),
          passDays: String(OFFERS.backlogPass.durationDays),
        }
      : {}),
  };
}

/**
 * Days the public `/refunds` page states (D121). The comparison CTA
 * stays blank until this equals `POLICY.refundWindowDays`.
 */
export const REFUNDS_PAGE_WINDOW_DAYS = 30;

/**
 * Money-back line under a comparison CTA, linked to `/refunds`.
 * With `PRICING_V2` on, `/refunds` is the deck page, so this is
 * `refundLine()`. Otherwise it stays empty while the published page
 * still states a different window.
 */
export function refundSentence(pricingV2 = isPricingV2()): string {
  if (pricingV2) return refundLine();
  if (ws3Tokens().refundDays === '') return '';
  // Widened: a literal `30 !== 14` is a type error, and the two
  // constants have to be comparable again once they are the same number.
  const publishedDays: number = REFUNDS_PAGE_WINDOW_DAYS;
  const policyDays: number = POLICY.refundWindowDays;
  if (publishedDays !== policyDays) return '';
  return refundLine();
}

export function declutrPriceSummary(passEnabled = passListed(), pricingV2 = isPricingV2()): string {
  if (!pricingCatalogReady()) return '';
  const template = passEnabled
    ? WS3_COPY['ws3.vs.declutr.price.summary']
    : WS3_COPY['ws3.vs.declutr.price.summary'].replace(/ or a one-time \{passName\}/, '');
  return fillComplete(template, launchTokenOverrides(pricingV2, passEnabled));
}

export function declutrPriceDetail(passEnabled = passListed(), pricingV2 = isPricingV2()): string {
  if (!pricingCatalogReady()) return '';
  const extra = launchTokenOverrides(pricingV2, passEnabled);
  if (!passEnabled) return fillComplete(WS3_COPY['ws3.vs.faq.price.a.passOff'], extra);
  return fillComplete(WS3_COPY['ws3.vs.declutr.price.detail'], extra);
}

const PRE_GATE_EXPLANATIONS = WS3_COPY['ws3.privacy.ai.explanations.preGate'];
const PRE_GATE_BRIEF = WS3_COPY['ws3.privacy.ai.brief.preGate'];

const BEFORE_GATE: Record<string, string> = {
  'ws3.security.ai.explanations': PRE_GATE_EXPLANATIONS,
  'ws3.security.ai.brief': PRE_GATE_BRIEF,
  'ws3.security.ai.control': '',
  'ws3.methodology.explanations':
    'Anthropic may turn the selected sender facts into a short explanation. It receives the sender’s name and domain, the suggested action, and the facts behind it. It does not receive subject lines, preview snippets, or full email contents for this explanation. If Anthropic is unavailable, DeclutrMail shows a standard explanation.',
  'ws3.methodology.briefBody': WS3_COPY['ws3.methodology.briefBody.preGate'],
  'ws3.privacy.ai.explanations': PRE_GATE_EXPLANATIONS,
  'ws3.privacy.ai.brief': PRE_GATE_BRIEF,
  'ws3.privacy.subprocessors.anthropic': WS3_COPY['ws3.privacy.subprocessors.anthropic.preGate'],
  'ws3.privacy.aiDisclosureConst': `${PRE_GATE_EXPLANATIONS} ${PRE_GATE_BRIEF}`,
  'ws3.privacy.ai.who': WS3_COPY['ws3.privacy.ai.who.preGate'],
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
  if (!AI_CONSENT_GATE_LIVE && key in BEFORE_GATE) return fillWs3(BEFORE_GATE[key] ?? '');
  const value = WS3_COPY[key];
  return typeof value === 'string' ? fillWs3(value) : '';
}

export function privacyFaqAnswer(): string {
  const full = fillWs3(WS3_COPY['ws3.vs.faq.privacy.a']);
  if (AI_CONSENT_GATE_LIVE) return full;
  const cut = full.split(' If you allow AI')[0] ?? full;
  return cut.endsWith('.') ? cut : `${cut}.`;
}

export function priceFaqAnswer(passEnabled = passListed(), pricingV2 = isPricingV2()): string {
  if (!pricingCatalogReady()) return '';
  const key = passEnabled ? 'ws3.vs.faq.price.a' : 'ws3.vs.faq.price.a.passOff';
  return fillComplete(WS3_COPY[key], launchTokenOverrides(pricingV2, passEnabled));
}

export function llmsAutopilotLine(): string {
  if (ws3Tokens().plusName === '') return '';
  return fillComplete(WS3_COPY['ws3.llms.fix.autopilot']);
}

export function llmsPricingLine(passEnabled = passListed(), pricingV2 = isPricingV2()): string {
  if (!pricingCatalogReady()) return '';
  const template = passEnabled
    ? WS3_COPY['ws3.llms.fix.pricingLink']
    : WS3_COPY['ws3.llms.fix.pricingLink'].replace(' and the one-time {passName}', '');
  return fillComplete(
    template,
    pricingV2 ? { refundDays: String(POLICY.refundWindowDays) } : undefined,
  );
}

export function llmsBetaLine(): string {
  if (LAUNCH_STAGE === 'ga') return WS3_COPY['ws3.llms.fix.beta'];
  return 'Open beta: sign in with Google and review senders, no invite or waitlist needed';
}

/** Pre-gate Key facts AI line. The deck bullet replaces it only after the gate. */
export const LLMS_AI_BEFORE_GATE = fillWs3(WS3_COPY['ws3.llms.keyFacts.aiPreGate']);

/** Storage-paragraph AI line. The `.gate` string replaces it once consent is live. */
export function llmsStorageAiLine(): string {
  const template = AI_CONSENT_GATE_LIVE
    ? WS3_COPY['ws3.llms.storageAi.gate']
    : WS3_COPY['ws3.llms.storageAi'];
  const filled = fillWs3(template);
  return filled.includes('{') ? '' : filled;
}

export function llmsKeyFacts(
  passEnabled = isBillingPassEnabled(),
  pricingV2 = isPricingV2(),
): readonly string[] {
  const facts = WS3_COPY['ws3.llms.keyFacts'];
  return facts.flatMap((fact, index) => {
    if (index === 3 && !AI_CONSENT_GATE_LIVE) return [LLMS_AI_BEFORE_GATE];
    // The deck points at the generated pricing section. Omit the pointer
    // while that section is empty so the file does not describe a heading
    // that is not there.
    if (index === 5 && renderPricingMarkdown(passEnabled, pricingV2).trim() === '') return [];
    if (index === 6) {
      return [fillWs3(fact, { factsCheckedDate: 'October 11, 2026' })];
    }
    return [fillComplete(fact)];
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
