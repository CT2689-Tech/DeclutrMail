/**
 * Public AI copy with the consent gate on (drop2-r18).
 *
 * Privacy, security, and methodology read the deck. The Brief lines open
 * with "{BRIEF_NAME} (part of {proName}; waitlist only for new accounts)",
 * and the consent step on those pages is "in the app".
 *
 * /llms.txt and /llms-full.txt do not render those six keys. They still
 * use ws3.llms.keyFacts and ws3.llms.storageAi.gate, which r18 left on
 * "in-app consent card".
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  fillWs3,
  gatedText,
  llmsKeyFacts,
  llmsStorageAiLine,
  WS3_COPY,
} from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { planName } from '@declutrmail/shared/entitlements';

import { renderLlmsFullTxt, renderLlmsTxt } from '@/features/marketing/llms/llms-document';

import MethodologyPage from './methodology/page';
import PrivacyPolicyPage from './privacy/page';
import SecurityPage from './security/page';

const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/;

function textOf(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('AI consent gate on the public pages', () => {
  it('renders the deck consent step on /privacy, /security, /methodology and /llms.txt', () => {
    const privacy = render(<PrivacyPolicyPage />);
    const security = render(<SecurityPage />);
    const methodology = render(<MethodologyPage />);
    const llms = renderLlmsTxt();
    const llmsFull = renderLlmsFullTxt();

    const privacyAi = privacy.container.querySelector('#ai-processing');
    const securityAi = security.container.querySelector('#ai-processing');
    const explanations = methodology.container.querySelector('#recommendations');
    const brief = methodology.container.querySelector('#brief-boundary');
    expect(privacyAi).not.toBeNull();
    expect(securityAi).not.toBeNull();
    expect(explanations).not.toBeNull();
    expect(brief).not.toBeNull();

    const privacyText = textOf(privacy.container);
    const securityText = textOf(security.container);
    const methodologyText = textOf(methodology.container);
    const privacyAiText = textOf(privacyAi!);
    const securityAiText = textOf(securityAi!);
    const explanationsText = textOf(explanations!);
    const briefText = textOf(brief!);

    for (const block of [privacyText, securityText, methodologyText, llms, llmsFull]) {
      expect(block).not.toMatch(PLACEHOLDER);
    }
    for (const block of [privacyAiText, securityAiText, explanationsText, briefText]) {
      expect(block.length).toBeGreaterThan(40);
    }

    const privacyExplanations = fillWs3(WS3_COPY['ws3.privacy.ai.explanations']);
    const privacyBrief = fillWs3(WS3_COPY['ws3.privacy.ai.brief']);
    const securityExplanations = fillWs3(WS3_COPY['ws3.security.ai.explanations']);
    const securityBrief = fillWs3(WS3_COPY['ws3.security.ai.brief']);
    const securityControl = fillWs3(WS3_COPY['ws3.security.ai.control']);
    const methodologyExplanations = gatedText('ws3.methodology.explanations');
    const aiFact = llmsKeyFacts()[3] ?? '';

    expect(privacyAiText).toContain(privacyExplanations);
    expect(privacyAiText).toContain(privacyBrief);
    expect(privacyText).toContain(fillWs3(WS3_COPY['ws3.privacy.aiDisclosureConst']));
    expect(privacyText).toContain(fillWs3(WS3_COPY['ws3.privacy.subprocessors.anthropic']));
    expect(securityAiText).toContain(securityExplanations);
    expect(securityAiText).toContain(securityBrief);
    expect(securityAiText).toContain(securityControl);
    expect(securityText).toContain('If you allow AI, some email details go to Anthropic');
    expect(explanationsText).toContain(methodologyExplanations);
    expect(briefText).toContain(gatedText('ws3.methodology.briefBody'));
    expect(briefText).not.toContain(fillWs3(WS3_COPY['ws3.methodology.briefBody.preGate']));
    expect(llms).toContain(aiFact);
    expect(llms).toContain(llmsStorageAiLine());
    expect(llms).not.toContain(fillWs3(WS3_COPY['ws3.llms.storageAi']));

    const briefOpen = `${BRIEF_NAME} (part of ${planName('pro')}; waitlist only for new accounts)`;
    expect(privacyBrief.startsWith(`${briefOpen}.`)).toBe(true);
    expect(securityBrief.startsWith(`${briefOpen}:`)).toBe(true);
    expect(privacyBrief).toContain('Only after you allow it in the app');
    expect(securityBrief).toContain('only after you allow it in the app');
    expect(privacyExplanations).toContain('allow AI in the app');
    expect(securityExplanations).toContain('allow it in the app');
    expect(methodologyExplanations).toContain('allow AI in the app');
    const briefBody = gatedText('ws3.methodology.briefBody');
    expect(briefBody.startsWith('Only after you allow it in the app,')).toBe(true);
    for (const sentence of [
      privacyExplanations,
      privacyBrief,
      securityExplanations,
      securityBrief,
      methodologyExplanations,
      briefBody,
    ]) {
      expect(sentence).not.toMatch(/consent card/);
      expect(sentence).not.toMatch(PLACEHOLDER);
    }
    for (const sentence of [privacyBrief, securityBrief, briefBody]) {
      expect(sentence).toContain(BRIEF_NAME);
    }
    expect(securityControl).toMatch(/Settings → AI/);
    expect(aiFact).toBe(fillWs3(WS3_COPY['ws3.llms.keyFacts'][3]));
    expect(aiFact).toContain('in-app consent card');
    expect(llmsFull).toContain(aiFact);
    expect(llmsFull).toContain(llmsStorageAiLine());
  });
});
