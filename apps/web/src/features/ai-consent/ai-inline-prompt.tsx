'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Button, tokens } from '@declutrmail/shared';
import { consentCard } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { hasCapability } from '@declutrmail/shared/entitlements';
import {
  AI_PROMPT_INTERVAL_DAYS,
  AI_PROMPT_MAX_DISMISSALS,
} from '@declutrmail/shared/copy/screen-decisions';

import { useTier } from '@/features/auth/api/use-tier';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

import { AiConsentCard } from './ai-consent-card';

const { color, font, text, radius } = tokens;
const PROMPT_KEY = 'dm.ai-prompt';
const DAY_MS = 24 * 60 * 60 * 1000;

function readPrompt(): { count: number; lastAt: number } {
  try {
    const raw = localStorage.getItem(PROMPT_KEY);
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

function promptDue(now: number): boolean {
  const stored = readPrompt();
  if (stored.count >= AI_PROMPT_MAX_DISMISSALS) return false;
  if (stored.lastAt === 0) return true;
  return now - stored.lastAt >= AI_PROMPT_INTERVAL_DAYS * DAY_MS;
}

/**
 * Dismissible nudge on Triage and Senders. "See what's sent" opens the
 * card. Choosing on the card, or two dismissals, ends the nudge.
 */
export function AiInlinePrompt() {
  const pathname = usePathname();
  const onSurface = pathname === '/triage' || pathname === '/senders';
  const settings = useQuery({ ...meSettingsQueryOptions(readMeSettings), enabled: onSurface });
  const { tier } = useTier();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const view = settings.data?.aiConsent;
  if (!onSurface || !view || hidden) return null;

  const briefCapable = hasCapability(tier, 'brief');
  const paused = view.explanations === 'paused' || (briefCapable && view.brief === 'paused');
  if (paused) return null;

  if (view.reask || view.explanations === 'review' || open) {
    const card = consentCard(view, briefCapable) ?? (briefCapable ? 'withBrief' : 'all');
    return <AiConsentCard view={view} card={card} onDone={() => setOpen(false)} />;
  }

  if (view.explanations !== 'unset' || !promptDue(Date.now())) return null;

  const prompt = WS2_COPY.aiPrompt;
  return (
    <div
      style={{
        fontFamily: font.sans,
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        padding: 12,
        margin: '12px 0',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <p style={{ margin: 0, flex: '1 1 220px', color: color.fg, fontSize: text.sm }}>
        {prompt.text}
      </p>
      <Button tone="primary" size="sm" onClick={() => setOpen(true)}>
        {prompt.review}
      </Button>
      <Button
        tone="ghost"
        size="sm"
        aria-label={prompt.dismissAria}
        onClick={() => {
          const stored = readPrompt();
          localStorage.setItem(
            PROMPT_KEY,
            JSON.stringify({ count: stored.count + 1, lastAt: Date.now() }),
          );
          setHidden(true);
        }}
      >
        {prompt.dismiss}
      </Button>
    </div>
  );
}
