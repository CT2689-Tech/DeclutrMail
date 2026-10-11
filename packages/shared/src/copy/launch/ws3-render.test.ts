import { describe, expect, it } from 'vitest';

import { cleanupActionsPerMonthFor, planName, POLICY } from '../../entitlements';
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
  glanceLines,
  llmsKeyFacts,
  declutrPriceDetail,
  declutrPriceSummary,
  llmsAutopilotLine,
  llmsPricingLine,
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
      'Google OAuth verification approved April 21, 2026. It covers the single restricted scope we request, gmail.modify.',
    );
    expect(casa).toContain('letter of validation was submitted to Google on April 15, 2026');
    expect(casa).not.toMatch(/\bapproved\b/i);
    expect(brand).toContain('approved August 18, 2026');
    const joined = `${oauth} ${casa} ${brand}`;
    expect(joined).not.toMatch(/\bcertified\b/i);
    expect(joined).not.toMatch(/\baudited\b/i);
  });

  it('fills {allowance} from the free-tier quota, not a typed 1,000', () => {
    const allowance = cleanupActionsPerMonthFor('free');
    expect(allowance).not.toBeNull();
    const note = fillWs3(WS3_COPY['ws3.home.note']);
    expect(note).toContain(allowance!.toLocaleString('en-US'));
    expect(note).not.toContain('{allowance}');
    expect(ws3Tokens().allowance).toBe(allowance!.toLocaleString('en-US'));
  });

  it('drops a clause whose filler is still empty', () => {
    expect(ws3Tokens().refundDays).toBe('');
    expect(ws3Tokens().passDays).toBe('');
    expect(ws3Tokens().passPrice).toBe('');
    expect(fillComplete('{refundDays}-day money-back on any purchase, once per customer.')).toBe(
      '',
    );
    expect(REFUNDS_PAGE_WINDOW_DAYS).not.toBe(POLICY.refundWindowDays);
    expect(refundSentence()).toBe('');
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
    expect(answer).not.toContain('-day money-back');
    expect(answer).not.toMatch(/\$19|\$59/);
    expect(answer).toContain(planName('free'));
    expect(answer).toContain(planName('plus'));
    expect(autopilot).toContain(planName('plus'));
    expect(autopilot).not.toMatch(/on\s+handle/);
  });

  it('keeps the consent gate off and lists the strings that wait for it', () => {
    expect(AI_CONSENT_GATE_LIVE).toBe(false);
    expect(gateOpen()).toBe(false);
    expect(AI_CONSENT_GATE_KEYS).toHaveLength(16);
    expect(privacyFaqAnswer()).not.toMatch(/If you allow AI/);
    expect(glanceLines().some((line) => /Anthropic/.test(line))).toBe(false);
    expect(llmsKeyFacts()[3]).toMatch(/Pro Brief may send the sender/);
    expect(llmsKeyFacts()[3]).not.toMatch(/consent card/);
  });
});
