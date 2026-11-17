import { describe, expect, it } from 'vitest';

import { METER, passAmount, planName, plusAmount, POLICY } from '../../entitlements';
import {
  BRAND_VERIFICATION_APPROVED_ON,
  CASA_LOV_SUBMITTED_ON,
  CASA_VERIFICATION_APPROVED_ON,
  formatVerificationDate,
} from '../privacy';
import { AI_CONSENT_GATE_KEYS, AI_CONSENT_GATE_LIVE } from './ws3-decisions';
import {
  fillComplete,
  fillWs3,
  gateOpen,
  gatedText,
  glanceLines,
  llmsKeyFacts,
  declutrPriceDetail,
  declutrPriceSummary,
  llmsAutopilotLine,
  llmsPricingLine,
  llmsStorageAiLine,
  priceFaqAnswer,
  privacyFaqAnswer,
  REFUNDS_PAGE_WINDOW_DAYS,
  refundSentence,
  ws3Tokens,
} from './ws3-render';
import { WS3_COPY } from './ws3';

describe('WS3 token fill', () => {
  it('formats the verification date in US order from the British constant', () => {
    expect(formatVerificationDate(CASA_VERIFICATION_APPROVED_ON)).toBe('April 21, 2026');
    expect(formatVerificationDate(CASA_LOV_SUBMITTED_ON)).toBe('April 15, 2026');
    expect(formatVerificationDate(BRAND_VERIFICATION_APPROVED_ON)).toBe('August 18, 2026');
  });

  it('states the three confirmed verification facts and nothing past them', () => {
    const oauth = fillWs3(WS3_COPY['ws3.security.verification.oauth']);
    const casa = fillWs3(WS3_COPY['ws3.security.verification.casa']);
    const brand = fillWs3(WS3_COPY['ws3.security.verification.brand']);
    expect(oauth).toBe(
      'Google OAuth verification approved April 21, 2026. It covers the single restricted permission we request, gmail.modify.',
    );
    expect(casa).toContain('letter of validation was submitted to Google on April 15, 2026');
    expect(casa).not.toMatch(/\bapproved\b/i);
    expect(brand).toContain('approved August 18, 2026');
    const joined = `${oauth} ${casa} ${brand}`;
    expect(joined).not.toMatch(/\bcertified\b/i);
    expect(joined).not.toMatch(/\baudited\b/i);
  });

  it('fills {allowance} from the free email meter', () => {
    const allowance = METER.free.limit.toLocaleString('en-US');
    const note = fillWs3(WS3_COPY['ws3.home.note']);
    expect(note).toContain(`${allowance} emails cleared a month`);
    expect(note).not.toContain('{allowance}');
    expect(ws3Tokens().allowance).toBe(allowance);
  });

  it('drops a clause whose filler is empty', () => {
    expect(
      fillComplete('{refundDays}-day money-back on any purchase, once per customer.', {
        refundDays: '',
      }),
    ).toBe('');
    expect(REFUNDS_PAGE_WINDOW_DAYS).toBe(POLICY.refundWindowDays);
  });

  it('fills launch prices and the refund window from config', () => {
    const days = String(POLICY.refundWindowDays);
    expect(ws3Tokens().refundDays).toBe(days);
    expect(ws3Tokens().plusPrice).toBe(plusAmount('usd'));
    expect(ws3Tokens().passPrice).toBe(passAmount('usd'));
    expect(refundSentence()).toBe(`${days}-day money-back on any purchase, once per customer.`);
    expect(llmsPricingLine()).toContain(`${days}-day money-back`);
    const answer = priceFaqAnswer();
    const summary = declutrPriceSummary();
    const detail = declutrPriceDetail();
    const pricing = llmsPricingLine();
    const autopilot = llmsAutopilotLine();
    for (const text of [answer, summary, detail, pricing, autopilot]) {
      expect(text).not.toContain('{');
      expect(text).not.toMatch(/ {2,}/);
      expect(text).not.toMatch(/,\s*,/);
      expect(text).not.toMatch(/(^|[.!?]\s+)-day\b/);
    }
    expect(answer).toContain(`${days}-day money-back`);
    expect(answer).toContain(plusAmount('usd'));
    expect(answer).toContain(passAmount('usd'));
    expect(answer).toContain(planName('free'));
    expect(answer).toContain(planName('plus'));
    expect(summary).toContain(planName('pass'));
    expect(detail).toContain(plusAmount('usd'));
    expect(autopilot).toContain(planName('plus'));
    expect(autopilot).not.toMatch(/on\s+handle/);
  });

  it('opens the consent gate and uses the deck consent sentences', () => {
    expect(AI_CONSENT_GATE_LIVE).toBe(true);
    expect(gateOpen()).toBe(true);
    expect(AI_CONSENT_GATE_KEYS).toHaveLength(16);
    expect(privacyFaqAnswer()).toMatch(/If you allow AI/);
    expect(glanceLines().some((line) => line.includes('If you allow AI'))).toBe(true);
    const aiFact = llmsKeyFacts()[3];
    expect(aiFact).toBe(fillWs3(WS3_COPY['ws3.llms.keyFacts'][3]));
    expect(aiFact).toContain('allows it in the app');
    expect(aiFact).not.toMatch(/consent card/);
    expect(aiFact).toContain('Settings → AI');
    expect(aiFact).not.toContain('Pro Brief');
    expect(llmsStorageAiLine()).toBe(fillWs3(WS3_COPY['ws3.llms.storageAi.gate']));
    expect(llmsStorageAiLine()).toContain('allows AI in the app');
    expect(llmsStorageAiLine()).not.toMatch(/consent card/);
    expect(gatedText('ws3.privacy.ai.explanations')).toBe(
      fillWs3(WS3_COPY['ws3.privacy.ai.explanations']),
    );
    expect(gatedText('ws3.security.ai.explanations')).toBe(
      fillWs3(WS3_COPY['ws3.security.ai.explanations']),
    );
    expect(gatedText('ws3.privacy.ai.brief')).toBe(fillWs3(WS3_COPY['ws3.privacy.ai.brief']));
    expect(gatedText('ws3.security.ai.brief')).toBe(fillWs3(WS3_COPY['ws3.security.ai.brief']));
    expect(gatedText('ws3.privacy.aiDisclosureConst')).toBe(
      fillWs3(WS3_COPY['ws3.privacy.aiDisclosureConst']),
    );
    expect(gatedText('ws3.privacy.ai.who')).toBe(fillWs3(WS3_COPY['ws3.privacy.ai.who']));
    expect(gatedText('ws3.privacy.subprocessors.anthropic')).toBe(
      fillWs3(WS3_COPY['ws3.privacy.subprocessors.anthropic']),
    );
    expect(gatedText('ws3.methodology.briefBody')).toBe(
      fillWs3(WS3_COPY['ws3.methodology.briefBody']),
    );
    expect(gatedText('ws3.methodology.briefBody')).not.toBe(
      fillWs3(WS3_COPY['ws3.methodology.briefBody.preGate']),
    );
  });
});
