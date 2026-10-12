/**
 * Public AI copy with the consent gate on.
 *
 * These four surfaces already read the deck. The test checks that the
 * gate-on sentences render whole: no leftover `{token}`, no blank AI
 * section, and the consent step in the words the deck uses (the in-app
 * consent card, and Settings → AI).
 *
 * #997 wired the Brief paragraph on /methodology and the storage
 * paragraph in /llms.txt through the same gate, so those sentences are
 * the deck's gate-on lines too.
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

import { renderLlmsTxt } from '@/features/marketing/llms/llms-document';

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

    for (const block of [privacyText, securityText, methodologyText, llms]) {
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

    const consentStep = [privacyExplanations, privacyBrief, methodologyExplanations, aiFact];
    for (const sentence of consentStep) {
      expect(sentence).toMatch(/consent card/);
      expect(sentence).toMatch(/Settings → AI/);
    }
    expect(securityControl).toMatch(/Settings → AI/);
    expect(securityExplanations).toMatch(/AI consent card/);
    expect(securityBrief).toMatch(/AI consent card/);
    expect(aiFact).toBe(fillWs3(WS3_COPY['ws3.llms.keyFacts'][3]));
  });
});
