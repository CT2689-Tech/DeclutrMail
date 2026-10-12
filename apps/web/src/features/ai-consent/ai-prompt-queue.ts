import { consentCard, type AiConsentView } from '@declutrmail/shared/ai-consent';
import {
  AI_PROMPT_INTERVAL_DAYS,
  AI_PROMPT_MAX_DISMISSALS,
} from '@declutrmail/shared/copy/screen-decisions';
import { hasCapability, type TierId } from '@declutrmail/shared/entitlements';

/** Shared with the inline nudge so heard-from can see a same-tab dismissal. */
export const AI_PROMPT_KEY = 'dm.ai-prompt';

/**
 * Brief upgrade re-ask. Separate from the explanations nudge: a server
 * decline has no local record, and that absence must not show the card.
 */
export const BRIEF_UPGRADE_KEY = 'dm.ai-prompt.brief';

/** Same-tab signal. `storage` does not fire in the tab that wrote the key. */
export const AI_PROMPT_CHANGED = 'dm-ai-prompt';

const DAY_MS = 24 * 60 * 60 * 1000;

export function readAiPrompt(): { count: number; lastAt: number } {
  try {
    const raw = localStorage.getItem(AI_PROMPT_KEY);
    if (!raw) return { count: 0, lastAt: 0 };
    const parsed = JSON.parse(raw) as { count?: unknown; lastAt?: unknown };
    return {
      count: typeof parsed.count === 'number' ? parsed.count : 0,
      lastAt: typeof parsed.lastAt === 'number' ? parsed.lastAt : 0,
    };
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

export function aiPromptDue(now: number): boolean {
  const stored = readAiPrompt();
  if (stored.count >= AI_PROMPT_MAX_DISMISSALS) return false;
  if (stored.lastAt === 0) return true;
  return now - stored.lastAt >= AI_PROMPT_INTERVAL_DAYS * DAY_MS;
}

export function dismissAiPrompt(now: number): void {
  const stored = readAiPrompt();
  localStorage.setItem(AI_PROMPT_KEY, JSON.stringify({ count: stored.count + 1, lastAt: now }));
  window.dispatchEvent(new Event(AI_PROMPT_CHANGED));
}

function readPromptRecord(key: string): { count: number; lastAt: number } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { count: 0, lastAt: 0 };
    const parsed = JSON.parse(raw) as { count?: unknown; lastAt?: unknown };
    return {
      count: typeof parsed.count === 'number' ? parsed.count : 0,
      lastAt: typeof parsed.lastAt === 'number' ? parsed.lastAt : 0,
    };
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

/**
 * True only after a recorded Brief "Not now" and the shared interval.
 * `lastAt === 0` means the server already declined and this browser has
 * not been asked again — the card stays hidden.
 */
export function briefUpgradeDue(now: number): boolean {
  const stored = readPromptRecord(BRIEF_UPGRADE_KEY);
  if (stored.count >= AI_PROMPT_MAX_DISMISSALS) return false;
  if (stored.lastAt === 0) return false;
  return now - stored.lastAt >= AI_PROMPT_INTERVAL_DAYS * DAY_MS;
}

export function dismissBriefUpgrade(now: number): void {
  const stored = readPromptRecord(BRIEF_UPGRADE_KEY);
  localStorage.setItem(BRIEF_UPGRADE_KEY, JSON.stringify({ count: stored.count + 1, lastAt: now }));
  window.dispatchEvent(new Event(AI_PROMPT_CHANGED));
}

/**
 * True while an AI consent card or the inline nudge is on screen.
 * Heard-from is fixed to the same corner, so it waits.
 */
export function aiConsentBlocksHeardFrom(args: {
  pathname: string;
  view: AiConsentView | undefined;
  tier: TierId;
  now: number;
  settingsPending: boolean;
}): boolean {
  const onBrief = args.pathname === '/brief';
  const onExplainSurface = args.pathname === '/triage' || args.pathname === '/senders';
  if (!onBrief && !onExplainSurface) return false;
  if (args.settingsPending) return true;
  const view = args.view;
  if (!view) return false;

  if (onBrief && hasCapability(args.tier, 'brief')) {
    const card = consentCard(view, true);
    if (card === 'withBrief' || card === 'upgrade') return true;
  }

  if (!onExplainSurface) return false;
  const paused =
    view.explanations === 'paused' ||
    (hasCapability(args.tier, 'brief') && view.brief === 'paused');
  if (paused) return false;
  if (view.reask || view.explanations === 'review') return true;
  return view.explanations === 'unset' && aiPromptDue(args.now);
}
