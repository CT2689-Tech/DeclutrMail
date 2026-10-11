import { describe, expect, it } from 'vitest';

import {
  aiConsentPatch,
  aiConsentView,
  briefConsentActive,
  consentCard,
  EMPTY_AI_CONSENT,
  explanationsConsentActive,
  type AiConsentStored,
} from './gate.js';

const VERSION = '2026-10';

function row(partial: Partial<AiConsentStored>): AiConsentStored {
  return { ...EMPTY_AI_CONSENT, ...partial };
}

const allowedExplanations = row({
  aiConsentVersion: VERSION,
  aiExplanationsConsentAt: '2026-10-02T00:00:00.000Z',
  aiConsentScopes: ['explanations'],
});

describe('AI consent gate', () => {
  it('treats a missing row as not allowed', () => {
    expect(explanationsConsentActive(null)).toBe(false);
    expect(briefConsentActive(undefined)).toBe(false);
    const view = aiConsentView(null);
    expect(view.explanations).toBe('unset');
    expect(consentCard(view, false)).toBe('all');
    expect(consentCard(view, true)).toBe('withBrief');
  });

  it('allows explanations only at the current version with the scope and no revoke', () => {
    expect(explanationsConsentActive(allowedExplanations)).toBe(true);
    expect(explanationsConsentActive({ ...allowedExplanations, aiConsentVersion: '2026-09' })).toBe(
      false,
    );
    expect(
      explanationsConsentActive({
        ...allowedExplanations,
        aiExplanationsRevokedAt: '2026-10-03T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(explanationsConsentActive({ ...allowedExplanations, aiConsentScopes: [] })).toBe(false);
  });

  it('shows the upgrade card after explanations were allowed and Brief is on the plan', () => {
    const view = aiConsentView(allowedExplanations);
    expect(view.explanations).toBe('allowed');
    expect(consentCard(view, false)).toBeNull();
    expect(consentCard(view, true)).toBe('upgrade');
  });

  it('hides the card after Not now on the full choice', () => {
    const declined = row({
      aiConsentVersion: VERSION,
      aiConsentDeclinedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(consentCard(aiConsentView(declined), false)).toBe(null);
    expect(consentCard(aiConsentView(declined), true)).toBe(null);
  });

  it('hides the upgrade card after Brief is declined, and Not now leaves explanations', () => {
    const declinedBrief = row({
      ...allowedExplanations,
      briefAiConsentVersion: VERSION,
      briefAiDeclinedAt: '2026-10-04T00:00:00.000Z',
    });
    const declinedView = aiConsentView(declinedBrief);
    expect(declinedView.brief).toBe('declined');
    expect(declinedView.explanations).toBe('allowed');
    expect(declinedView.reask).toBe(false);
    expect(consentCard(declinedView, true)).toBeNull();
    expect(consentCard(declinedView, false)).toBeNull();

    const revokedBrief = row({
      ...allowedExplanations,
      briefAiConsentAt: '2026-10-03T00:00:00.000Z',
      briefAiConsentVersion: VERSION,
      aiConsentScopes: ['explanations', 'brief'],
      briefAiConsentRevokedAt: '2026-10-04T00:00:00.000Z',
    });
    const revokedView = aiConsentView(revokedBrief);
    expect(revokedView.brief).toBe('off');
    expect(consentCard(revokedView, true)).toBeNull();

    const patch = aiConsentPatch({ action: 'not_now', card: 'upgrade' });
    expect(patch).toMatchObject({
      aiExplanationsConsentAt: 'keep',
      aiExplanationsRevokedAt: 'keep',
      aiConsentDeclinedAt: 'keep',
      aiConsentScopes: 'keep',
      briefAiDeclinedAt: 'now',
      briefAiConsentAt: null,
    });
    expect(explanationsConsentActive(declinedBrief)).toBe(true);
    expect(explanationsConsentActive(revokedBrief)).toBe(true);
  });

  it('shows the upgrade card again when a stored Brief version is no longer current', () => {
    const staleBrief = row({
      ...allowedExplanations,
      briefAiConsentVersion: '2026-09',
      briefAiDeclinedAt: '2026-10-04T00:00:00.000Z',
    });
    const view = aiConsentView(staleBrief);
    expect(view.explanations).toBe('allowed');
    expect(view.reask).toBe(true);
    expect(consentCard(view, true)).toBe('upgrade');
  });

  it('re-asks when the stored version is not current', () => {
    const old = row({
      aiConsentVersion: '2026-09',
      aiExplanationsConsentAt: '2026-09-01T00:00:00.000Z',
      aiConsentScopes: ['explanations'],
    });
    const view = aiConsentView(old);
    expect(view.reask).toBe(true);
    expect(view.explanations).toBe('review');
    expect(explanationsConsentActive(old)).toBe(false);
    expect(consentCard(view, true)).toBe('withBrief');
  });

  it('writes Allow, Not now, upgrade, and revoke without granting a scope that was declined', () => {
    expect(aiConsentPatch({ action: 'allow', card: 'all' })).toMatchObject({
      aiConsentVersion: VERSION,
      aiExplanationsConsentAt: 'now',
      aiConsentScopes: ['explanations', 'brief'],
      briefAiConsentAt: 'keep',
      briefAiDeclinedAt: 'keep',
    });
    expect(aiConsentPatch({ action: 'allow', card: 'withBrief' }).aiConsentScopes).toEqual([
      'explanations',
      'brief',
    ]);
    expect(aiConsentPatch({ action: 'not_now', card: 'all' })).toMatchObject({
      aiExplanationsConsentAt: null,
      aiConsentDeclinedAt: 'now',
      aiConsentScopes: 'keep',
      briefAiDeclinedAt: 'keep',
      briefAiConsentAt: 'keep',
    });
    expect(aiConsentPatch({ action: 'not_now', card: 'upgrade' })).toMatchObject({
      aiExplanationsConsentAt: 'keep',
      briefAiDeclinedAt: 'now',
      briefAiConsentVersion: VERSION,
    });
    expect(aiConsentPatch({ action: 'revoke' })).toMatchObject({
      aiExplanationsRevokedAt: 'now',
      briefAiConsentRevokedAt: 'now',
      aiConsentScopes: 'keep',
    });
    expect(aiConsentPatch({ action: 'revoke', scope: 'explanations' })).toMatchObject({
      aiExplanationsRevokedAt: 'now',
      briefAiConsentRevokedAt: 'keep',
      briefAiDeclinedAt: 'keep',
      aiConsentScopes: 'keep',
    });
    expect(aiConsentPatch({ action: 'revoke', scope: 'brief' })).toMatchObject({
      aiExplanationsRevokedAt: 'keep',
      briefAiConsentRevokedAt: 'now',
    });
    expect(aiConsentPatch({ action: 'allow', card: 'upgrade' })).toMatchObject({
      briefAiConsentAt: 'now',
      aiConsentScopes: ['explanations', 'brief'],
      aiExplanationsRevokedAt: null,
    });
  });
});
