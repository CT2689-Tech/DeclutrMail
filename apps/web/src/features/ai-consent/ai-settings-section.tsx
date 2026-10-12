'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';

import { toast, tokens } from '@declutrmail/shared';
import type { AiConsentCard as CardKind, AiConsentView } from '@declutrmail/shared/ai-consent';
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

function SwitchHelp({ text, note }: { text: string; note?: string | undefined }): ReactNode {
  return (
    <>
      {note ? <span style={{ display: 'block' }}>{note}</span> : null}
      <span>{text} </span>
      <Link className="dm-external-link" href="/privacy#ai-processing">
        {copy.link}
      </Link>
    </>
  );
}

/**
 * Settings → AI. Explanations are their own switch. Brief, on plans that
 * have it, is a second switch that opens the upgrade card only when the
 * user asks. A declined Brief does not keep that card on screen.
 */
export function AiSettingsSection({
  view,
  briefCapable,
}: {
  view: AiConsentView;
  briefCapable: boolean;
}) {
  const decide = useDecideAiConsent();
  const [asking, setAsking] = useState<CardKind | null>(null);
  const [failed, setFailed] = useState(false);
  const explanationsPaused = view.explanations === 'paused';
  const briefPaused = view.brief === 'paused';
  const explanationsOn = !explanationsPaused && view.explanations === 'allowed';
  const briefOn = !briefPaused && view.brief === 'allowed';
  const explanationsLabel = copy.settings.label.all;
  const briefLabel = fillBrief(copy.settings.brief.label);
  const stateNote = explanationsPaused
    ? copy.settings.state.paused
    : view.explanations === 'review' || (view.reask && !explanationsOn)
      ? copy.settings.state.review
      : undefined;
  const explanationsNote =
    [view.reask ? copy.reask : null, stateNote].filter((part) => part != null).join(' ') ||
    undefined;

  async function revoke(scope: 'explanations' | 'brief'): Promise<void> {
    setFailed(false);
    try {
      await decide.mutateAsync({ action: 'revoke', scope });
      void track('brief_ai_consent_revoked', {});
      toast(
        scope === 'explanations' ? copy.revoked.toast.all : fillBrief(copy.brief.revoked),
        'info',
      );
      setAsking(null);
    } catch {
      setFailed(true);
    }
  }

  return (
    <SettingsGroup id="ai" title="AI" focusable>
      <SettingsRow
        label={explanationsLabel}
        detail={<SwitchHelp text={copy.settings.help.all} note={explanationsNote} />}
      >
        <SettingsSwitch
          ariaLabel={explanationsLabel}
          on={explanationsOn}
          stateLabel={explanationsOn ? copy.settings.state.on : copy.settings.state.off}
          disabled={explanationsPaused || decide.isPending}
          pending={decide.isPending}
          onToggle={() => {
            if (explanationsOn) void revoke('explanations');
            else setAsking('all');
          }}
        />
      </SettingsRow>
      {briefCapable && (
        <SettingsRow
          label={briefLabel}
          detail={
            <SwitchHelp
              text={fillBrief(copy.settings.brief.help)}
              note={briefPaused ? fillBrief(copy.killSwitch) : undefined}
            />
          }
        >
          <SettingsSwitch
            ariaLabel={briefLabel}
            on={briefOn}
            stateLabel={briefOn ? copy.settings.state.on : copy.settings.state.off}
            disabled={briefPaused || decide.isPending}
            pending={decide.isPending}
            onToggle={() => {
              if (briefOn) void revoke('brief');
              else setAsking('upgrade');
            }}
          />
        </SettingsRow>
      )}
      {failed && (
        <p role="alert" style={{ margin: '8px 16px', color: color.dangerText, fontSize: text.sm }}>
          {copy.error}
        </p>
      )}
      {asking && <AiConsentCard view={view} card={asking} onDone={() => setAsking(null)} />}
    </SettingsGroup>
  );
}
