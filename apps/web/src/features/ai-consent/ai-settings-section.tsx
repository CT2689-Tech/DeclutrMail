'use client';

import { useState } from 'react';

import { toast, tokens } from '@declutrmail/shared';
import { consentCard, type AiConsentView } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { SettingsGroup, SettingsRow, SettingsSwitch } from '@/features/settings/settings-list';
import { track } from '@/lib/posthog';

import { AiConsentCard } from './ai-consent-card';
import { useDecideAiConsent } from './use-decide-ai-consent';

const { color, text } = tokens;
const copy = WS2_COPY.aiConsent;

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

/** Settings → AI. One switch. Turning it on opens the card; turning it off revokes. */
export function AiSettingsSection({
  view,
  briefCapable,
}: {
  view: AiConsentView;
  briefCapable: boolean;
}) {
  const decide = useDecideAiConsent();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const paused = view.explanations === 'paused' || (briefCapable && view.brief === 'paused');
  const review = view.reask || view.explanations === 'review';
  const toggleOn =
    !paused && view.explanations === 'allowed' && (!briefCapable || view.brief === 'allowed');
  const serverCard = paused ? null : consentCard(view, briefCapable);
  const card = serverCard ?? (asking ? (briefCapable ? 'withBrief' : 'all') : null);
  const label = fillBrief(briefCapable ? copy.settings.label.withBrief : copy.settings.label.all);
  const detail = paused
    ? copy.settings.state.paused
    : review
      ? copy.settings.state.review
      : fillBrief(briefCapable ? copy.settings.help.withBrief : copy.settings.help.all);

  async function onToggle(): Promise<void> {
    setFailed(false);
    if (paused) return;
    if (toggleOn) {
      try {
        await decide.mutateAsync({ action: 'revoke' });
        void track('brief_ai_consent_revoked', {});
        toast(
          fillBrief(briefCapable ? copy.revoked.toast.withBrief : copy.revoked.toast.all),
          'info',
        );
        setAsking(false);
      } catch {
        setFailed(true);
      }
      return;
    }
    setAsking(true);
  }

  return (
    <SettingsGroup id="ai" title="AI" focusable>
      <SettingsRow label={label} detail={detail}>
        <SettingsSwitch
          ariaLabel={label}
          on={toggleOn}
          stateLabel={toggleOn ? copy.settings.state.on : copy.settings.state.off}
          disabled={paused || decide.isPending}
          pending={decide.isPending}
          onToggle={() => void onToggle()}
        />
      </SettingsRow>
      {failed && (
        <p role="alert" style={{ margin: '8px 16px', color: color.dangerText, fontSize: text.sm }}>
          {copy.error}
        </p>
      )}
      {card && <AiConsentCard view={view} card={card} onDone={() => setAsking(false)} />}
    </SettingsGroup>
  );
}
