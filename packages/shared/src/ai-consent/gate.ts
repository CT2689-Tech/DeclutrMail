import { AI_CONSENT_VERSION } from '../copy/screen-decisions.js';

export type AiConsentCard = 'all' | 'withBrief' | 'upgrade';

export type AiConsentExplanationsState = 'unset' | 'allowed' | 'off' | 'paused' | 'review';

export type AiConsentBriefState = 'unset' | 'allowed' | 'off' | 'paused' | 'review' | 'declined';

export interface AiConsentStored {
  aiConsentVersion: string | null;
  aiExplanationsConsentAt: Date | string | null;
  aiExplanationsRevokedAt: Date | string | null;
  aiConsentScopes: readonly string[] | null;
  aiConsentDeclinedAt: Date | string | null;
  briefAiConsentAt: Date | string | null;
  briefAiConsentVersion: string | null;
  briefAiConsentRevokedAt: Date | string | null;
  briefAiDeclinedAt: Date | string | null;
}

export function aiConsentFromPartial(
  row: Partial<AiConsentStored> | null | undefined,
): AiConsentStored {
  if (!row) return EMPTY_AI_CONSENT;
  return {
    aiConsentVersion: row.aiConsentVersion ?? null,
    aiExplanationsConsentAt: row.aiExplanationsConsentAt ?? null,
    aiExplanationsRevokedAt: row.aiExplanationsRevokedAt ?? null,
    aiConsentScopes: row.aiConsentScopes ?? null,
    aiConsentDeclinedAt: row.aiConsentDeclinedAt ?? null,
    briefAiConsentAt: row.briefAiConsentAt ?? null,
    briefAiConsentVersion: row.briefAiConsentVersion ?? null,
    briefAiConsentRevokedAt: row.briefAiConsentRevokedAt ?? null,
    briefAiDeclinedAt: row.briefAiDeclinedAt ?? null,
  };
}

export const EMPTY_AI_CONSENT: AiConsentStored = {
  aiConsentVersion: null,
  aiExplanationsConsentAt: null,
  aiExplanationsRevokedAt: null,
  aiConsentScopes: null,
  aiConsentDeclinedAt: null,
  briefAiConsentAt: null,
  briefAiConsentVersion: null,
  briefAiConsentRevokedAt: null,
  briefAiDeclinedAt: null,
};

export interface AiConsentView {
  explanations: AiConsentExplanationsState;
  brief: AiConsentBriefState;
  reask: boolean;
}

export type AiConsentDecision =
  | { action: 'allow'; card: AiConsentCard }
  | { action: 'not_now'; card: AiConsentCard }
  | { action: 'revoke'; scope?: 'explanations' | 'brief' | undefined };

/** Column write. `now` is the database clock; `keep` leaves the column. */
export type ConsentMark = 'now' | 'keep' | null;

export interface AiConsentPatch {
  aiConsentVersion: string | null | 'keep';
  aiExplanationsConsentAt: ConsentMark;
  aiExplanationsRevokedAt: ConsentMark;
  aiConsentScopes: string[] | 'keep';
  aiConsentDeclinedAt: ConsentMark;
  briefAiConsentAt: ConsentMark;
  briefAiConsentVersion: string | null | 'keep';
  briefAiConsentRevokedAt: ConsentMark;
  briefAiDeclinedAt: ConsentMark;
}

function present(value: Date | string | null | undefined): boolean {
  return value != null && value !== '';
}

function hasScope(row: AiConsentStored, scope: 'explanations' | 'brief'): boolean {
  return (row.aiConsentScopes ?? []).includes(scope);
}

export function explanationsConsentActive(
  row: AiConsentStored | null | undefined,
  version: string = AI_CONSENT_VERSION,
): boolean {
  if (!row) return false;
  return (
    row.aiConsentVersion === version &&
    present(row.aiExplanationsConsentAt) &&
    !present(row.aiExplanationsRevokedAt) &&
    hasScope(row, 'explanations')
  );
}

export function briefConsentActive(
  row: AiConsentStored | null | undefined,
  version: string = AI_CONSENT_VERSION,
): boolean {
  if (!row) return false;
  return (
    row.briefAiConsentVersion === version &&
    present(row.briefAiConsentAt) &&
    !present(row.briefAiConsentRevokedAt) &&
    hasScope(row, 'brief')
  );
}

function explanationsRaw(row: AiConsentStored, version: string): AiConsentExplanationsState {
  if (row.aiConsentVersion != null && row.aiConsentVersion !== version) return 'review';
  if (explanationsConsentActive(row, version)) return 'allowed';
  if (present(row.aiConsentDeclinedAt) || present(row.aiExplanationsRevokedAt)) return 'off';
  return 'unset';
}

function briefRaw(row: AiConsentStored, version: string): AiConsentBriefState {
  if (row.briefAiConsentVersion != null && row.briefAiConsentVersion !== version) return 'review';
  if (briefConsentActive(row, version)) return 'allowed';
  if (
    present(row.briefAiDeclinedAt) &&
    row.briefAiConsentVersion === version &&
    !present(row.briefAiConsentAt)
  ) {
    return 'declined';
  }
  if (present(row.briefAiConsentRevokedAt)) return 'off';
  return 'unset';
}

export function aiConsentView(
  row: AiConsentStored | null | undefined,
  options?: { version?: string },
): AiConsentView {
  const version = options?.version ?? AI_CONSENT_VERSION;
  const stored = row ?? EMPTY_AI_CONSENT;
  const reask =
    (stored.aiConsentVersion != null && stored.aiConsentVersion !== version) ||
    (stored.briefAiConsentVersion != null && stored.briefAiConsentVersion !== version);
  return {
    explanations: explanationsRaw(stored, version),
    brief: briefRaw(stored, version),
    reask,
  };
}

/**
 * Which card to show on Brief. A paused view hides the card.
 * A Brief decline stays hidden until `reask` (stored version) or the
 * 30-day cadence in the prompt queue. Settings does not use this to
 * keep a card on screen.
 */
export function consentCard(view: AiConsentView, briefCapable: boolean): AiConsentCard | null {
  if (view.explanations === 'paused') return null;
  if (briefCapable && view.brief === 'paused') return null;
  if (view.explanations === 'review' || view.explanations === 'unset') {
    return briefCapable ? 'withBrief' : 'all';
  }
  if (view.explanations !== 'allowed' && view.reask) {
    return briefCapable ? 'withBrief' : 'all';
  }
  if (!briefCapable || view.explanations !== 'allowed' || view.brief === 'allowed') return null;
  // First Brief offer, or a version re-ask. A decline or revoke waits
  // for the 30-day cadence instead of staying on screen.
  if (view.brief === 'unset' || view.reask || view.brief === 'review') return 'upgrade';
  return null;
}

const KEEP: Pick<
  AiConsentPatch,
  | 'aiExplanationsConsentAt'
  | 'aiExplanationsRevokedAt'
  | 'aiConsentDeclinedAt'
  | 'briefAiConsentAt'
  | 'briefAiConsentRevokedAt'
  | 'briefAiDeclinedAt'
> = {
  aiExplanationsConsentAt: 'keep',
  aiExplanationsRevokedAt: 'keep',
  aiConsentDeclinedAt: 'keep',
  briefAiConsentAt: 'keep',
  briefAiConsentRevokedAt: 'keep',
  briefAiDeclinedAt: 'keep',
};

/**
 * Scopes this Allow card showed. The Brief upgrade keeps an existing
 * explanations grant. The explanations-only card keeps a prior Brief
 * scope and does not grant Brief when previous has none.
 */
function scopesAgreedOnCard(card: AiConsentCard): readonly string[] {
  switch (card) {
    case 'all':
      return ['explanations'];
    case 'withBrief':
      return ['explanations', 'brief'];
    case 'upgrade':
      return ['brief'];
    default: {
      const unreachable: never = card;
      return unreachable;
    }
  }
}

function allowScopes(card: AiConsentCard, previous: readonly string[] | null): string[] {
  const kept = new Set(scopesAgreedOnCard(card));
  const prior = previous ?? [];
  if (card === 'upgrade' && prior.includes('explanations')) kept.add('explanations');
  if (card === 'all' && prior.includes('brief')) kept.add('brief');
  return ['explanations', 'brief'].filter((scope) => kept.has(scope));
}

export function aiConsentPatch(
  decision: AiConsentDecision,
  version: string = AI_CONSENT_VERSION,
  previousScopes: readonly string[] | null = null,
): AiConsentPatch {
  if (decision.action === 'revoke') {
    return {
      ...KEEP,
      aiConsentVersion: 'keep',
      aiConsentScopes: 'keep',
      briefAiConsentVersion: 'keep',
      ...(decision.scope !== 'brief' ? { aiExplanationsRevokedAt: 'now' as const } : {}),
      ...(decision.scope !== 'explanations' ? { briefAiConsentRevokedAt: 'now' as const } : {}),
    };
  }
  if (decision.action === 'not_now' && decision.card === 'upgrade') {
    return {
      ...KEEP,
      aiConsentVersion: 'keep',
      aiConsentScopes: 'keep',
      briefAiConsentVersion: version,
      briefAiConsentAt: null,
      briefAiConsentRevokedAt: null,
      briefAiDeclinedAt: 'now',
    };
  }
  if (decision.action === 'not_now') {
    const withBrief = decision.card === 'withBrief';
    if (!withBrief) {
      return {
        aiConsentVersion: version,
        aiExplanationsConsentAt: null,
        aiExplanationsRevokedAt: null,
        aiConsentScopes: 'keep',
        aiConsentDeclinedAt: 'now',
        briefAiConsentAt: 'keep',
        briefAiConsentVersion: 'keep',
        briefAiConsentRevokedAt: 'keep',
        briefAiDeclinedAt: 'keep',
      };
    }
    return {
      aiConsentVersion: version,
      aiExplanationsConsentAt: null,
      aiExplanationsRevokedAt: null,
      aiConsentScopes: [],
      aiConsentDeclinedAt: 'now',
      briefAiConsentAt: null,
      briefAiConsentVersion: version,
      briefAiConsentRevokedAt: null,
      briefAiDeclinedAt: 'now',
    };
  }
  if (decision.card === 'upgrade') {
    return {
      ...KEEP,
      aiConsentVersion: version,
      aiExplanationsConsentAt: 'keep',
      aiConsentScopes: allowScopes(decision.card, previousScopes),
      briefAiConsentAt: 'now',
      briefAiConsentVersion: version,
      briefAiConsentRevokedAt: null,
      briefAiDeclinedAt: null,
    };
  }
  const withBrief = decision.card === 'withBrief';
  if (!withBrief) {
    return {
      aiConsentVersion: version,
      aiExplanationsConsentAt: 'now',
      aiExplanationsRevokedAt: null,
      aiConsentScopes: allowScopes(decision.card, previousScopes),
      aiConsentDeclinedAt: null,
      briefAiConsentAt: 'keep',
      briefAiConsentVersion: 'keep',
      briefAiConsentRevokedAt: 'keep',
      briefAiDeclinedAt: 'keep',
    };
  }
  return {
    aiConsentVersion: version,
    aiExplanationsConsentAt: 'now',
    aiExplanationsRevokedAt: null,
    aiConsentScopes: allowScopes(decision.card, previousScopes),
    aiConsentDeclinedAt: null,
    briefAiConsentAt: 'now',
    briefAiConsentVersion: version,
    briefAiConsentRevokedAt: null,
    briefAiDeclinedAt: null,
  };
}

/** Spread into a user insert so existing LLM tests still reach the port. */
export function grantedAiConsentInsert(at: Date = new Date('2026-10-01T00:00:00.000Z')): {
  aiConsentVersion: string;
  aiExplanationsConsentAt: Date;
  aiConsentScopes: string[];
  briefAiConsentAt: Date;
  briefAiConsentVersion: string;
} {
  return {
    aiConsentVersion: AI_CONSENT_VERSION,
    aiExplanationsConsentAt: at,
    aiConsentScopes: ['explanations', 'brief'],
    briefAiConsentAt: at,
    briefAiConsentVersion: AI_CONSENT_VERSION,
  };
}
