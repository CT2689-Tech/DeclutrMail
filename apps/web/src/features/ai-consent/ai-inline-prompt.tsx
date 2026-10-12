'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { consentCard } from '@declutrmail/shared/ai-consent';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { useOptionalAuth } from '@/features/auth/auth-provider';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

import { AiConsentCard } from './ai-consent-card';
import { aiPromptDue, dismissAiPrompt } from './ai-prompt-queue';

/** The page column already insets the card. A second inset makes it narrower than the title. */
export function AiInlineConsentInset({ children }: { children: ReactNode }) {
  return <div data-testid="ai-inline-consent">{children}</div>;
}

/**
 * Short consent card on Triage and Senders. The show rule is the
 * two-dismissal queue. Not now dismisses; Allow stores consent.
 */
export function AiInlinePrompt() {
  const settings = useQuery(meSettingsQueryOptions(readMeSettings));
  const auth = useOptionalAuth();
  const [hidden, setHidden] = useState(false);
  // The nudge reads localStorage. The server has no record, so it
  // must not paint that card into HTML the browser then disagrees with.
  const [promptReady, setPromptReady] = useState(false);
  useEffect(() => {
    setPromptReady(true);
  }, []);
  const view = settings.data?.aiConsent;
  if (!view || hidden) return null;

  const briefCapable = hasCapability(auth?.me.tier ?? 'free', 'brief');
  const paused = view.explanations === 'paused' || (briefCapable && view.brief === 'paused');
  if (paused) return null;

  if (view.reask || view.explanations === 'review') {
    const fromGate = consentCard(view, briefCapable);
    const card =
      fromGate ?? (view.explanations === 'allowed' ? null : briefCapable ? 'withBrief' : 'all');
    if (!card) return null;
    return (
      <AiInlineConsentInset>
        <AiConsentCard view={view} card={card} />
      </AiInlineConsentInset>
    );
  }

  if (!promptReady || view.explanations !== 'unset' || !aiPromptDue(Date.now())) return null;

  const card = briefCapable ? 'withBrief' : 'all';
  return (
    <AiInlineConsentInset>
      <AiConsentCard
        view={view}
        card={card}
        onNotNow={() => {
          dismissAiPrompt(Date.now());
          setHidden(true);
        }}
        onDone={() => setHidden(true)}
      />
    </AiInlineConsentInset>
  );
}
