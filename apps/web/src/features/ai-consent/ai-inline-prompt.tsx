'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button, tokens } from '@declutrmail/shared';
import { consentCard } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { useOptionalAuth } from '@/features/auth/auth-provider';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

import { AiConsentCard } from './ai-consent-card';
import { aiPromptDue, dismissAiPrompt } from './ai-prompt-queue';

const { color, font, text, radius } = tokens;

/** The page column already insets the card. A second inset makes it narrower than the title. */
export function AiInlineConsentInset({ children }: { children: ReactNode }) {
  return <div data-testid="ai-inline-consent">{children}</div>;
}

/**
 * Dismissible nudge on Triage and Senders. "Learn more" opens the
 * card. Choosing on the card, or two dismissals, ends the nudge.
 */
export function AiInlinePrompt() {
  const settings = useQuery(meSettingsQueryOptions(readMeSettings));
  const auth = useOptionalAuth();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  // The suggestion reads localStorage. The server has no record, so it
  // must not paint that row into HTML the browser then disagrees with.
  const [promptReady, setPromptReady] = useState(false);
  useEffect(() => {
    setPromptReady(true);
  }, []);
  const view = settings.data?.aiConsent;
  if (!view || hidden) return null;

  const briefCapable = hasCapability(auth?.me.tier ?? 'free', 'brief');
  const paused = view.explanations === 'paused' || (briefCapable && view.brief === 'paused');
  if (paused) return null;

  if (view.reask || view.explanations === 'review' || open) {
    const fromGate = consentCard(view, briefCapable);
    const card =
      fromGate ?? (view.explanations === 'allowed' ? null : briefCapable ? 'withBrief' : 'all');
    if (!card) return null;
    return (
      <AiInlineConsentInset>
        <AiConsentCard view={view} card={card} onDone={() => setOpen(false)} />
      </AiInlineConsentInset>
    );
  }

  if (!promptReady || view.explanations !== 'unset' || !aiPromptDue(Date.now())) return null;

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
