'use client';

import { useQuery } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';
import { consentCard } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { useOptionalAuth } from '@/features/auth/auth-provider';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

import { AiConsentCard } from './ai-consent-card';

const { color, font, text } = tokens;

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

/**
 * On Daily Brief: the consent card when Brief AI still needs a choice,
 * otherwise a one-line note that the basic Brief is what's showing.
 */
export function BriefAiConsent() {
  const settings = useQuery(meSettingsQueryOptions(readMeSettings));
  const auth = useOptionalAuth();
  const tier = auth?.me.tier ?? 'free';
  const view = settings.data?.aiConsent;
  if (!view || !hasCapability(tier, 'brief')) return null;

  const card = consentCard(view, true);
  if (card === 'withBrief' || card === 'upgrade') {
    return <AiConsentCard view={view} card={card} />;
  }
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
