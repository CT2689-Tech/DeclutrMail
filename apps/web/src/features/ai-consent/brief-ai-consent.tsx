'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';
import { consentCard, type AiConsentCard as CardKind } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { useOptionalAuth } from '@/features/auth/auth-provider';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

import { AiConsentCard } from './ai-consent-card';
import { AI_PROMPT_CHANGED, briefUpgradeDue } from './ai-prompt-queue';

const { color, font, text } = tokens;

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

/**
 * On Daily Brief: the consent card when Brief AI still needs a choice,
 * otherwise a one-line note that the basic Brief is what's showing.
 * A decline stays on that note until the stored version changes or the
 * 30-day re-ask is due. The re-ask reads localStorage only after mount
 * so the server render and the first client paint agree.
 */
export function BriefAiConsent() {
  const settings = useQuery(meSettingsQueryOptions(readMeSettings));
  const auth = useOptionalAuth();
  const tier = auth?.me.tier ?? 'free';
  const view = settings.data?.aiConsent;
  const [upgradeDue, setUpgradeDue] = useState(false);

  useEffect(() => {
    const sync = () => setUpgradeDue(briefUpgradeDue(Date.now()));
    sync();
    window.addEventListener(AI_PROMPT_CHANGED, sync);
    return () => window.removeEventListener(AI_PROMPT_CHANGED, sync);
  }, []);

  if (!view || !hasCapability(tier, 'brief')) return null;

  const gated = consentCard(view, true);
  const reaskUpgrade =
    upgradeDue &&
    view.explanations === 'allowed' &&
    (view.brief === 'declined' || view.brief === 'off');
  const card: CardKind | null =
    gated === 'withBrief' || gated === 'upgrade' ? gated : reaskUpgrade ? 'upgrade' : null;
  if (card) return <AiConsentCard view={view} card={card} />;
  if (view.brief === 'allowed') return null;

  const paused = view.brief === 'paused' || view.explanations === 'paused';
  return (
    <p
      role="status"
      style={{ fontFamily: font.sans, fontSize: text.sm, color: color.fgSoft, margin: '12px 0' }}
    >
      {paused
        ? fillBrief(WS2_COPY.aiConsent.killSwitch)
        : fillBrief(WS2_COPY.aiConsent.missing.banner)}
    </p>
  );
}
