'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Button, tokens } from '@declutrmail/shared';
import { consentCard } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

import { AiConsentCard } from './ai-consent-card';
import { aiPromptDue, dismissAiPrompt } from './ai-prompt-queue';

const { color, font, text, radius } = tokens;

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

  if (view.explanations !== 'unset' || !aiPromptDue(Date.now())) return null;

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
        ariaLabel={prompt.dismissAria}
        onClick={() => {
          dismissAiPrompt(Date.now());
          setHidden(true);
        }}
      >
        {prompt.dismiss}
      </Button>
    </div>
  );
}
