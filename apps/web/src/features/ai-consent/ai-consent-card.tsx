'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { Button, toast, tokens } from '@declutrmail/shared';
import type { AiConsentCard as CardKind, AiConsentView } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { track } from '@/lib/posthog';

import { useDecideAiConsent } from './use-decide-ai-consent';

const { color, font, text, radius } = tokens;
const copy = WS2_COPY.aiConsent;

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

/**
 * Allow / Not now. No checkbox, and nothing is selected until the user
 * presses a button. Links go to the privacy AI section.
 */
export function AiConsentCard({
  view,
  card,
  onDone,
}: {
  view: AiConsentView;
  card: CardKind;
  onDone?: () => void;
}) {
  const decide = useDecideAiConsent();
  const inflight = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void track('brief_ai_consent_shown', {});
  }, []);

  async function choose(action: 'allow' | 'not_now'): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setFailed(false);
    try {
      await decide.mutateAsync({ action, card });
      void track('brief_ai_consent_decided', { decision: action });
      if (action === 'allow') {
        const toastCopy =
          card === 'all' ? copy.allowed.toast.all : fillBrief(copy.allowed.toast.withBrief);
        toast(toastCopy, 'info');
      }
      onDone?.();
    } catch {
      setFailed(true);
    } finally {
      inflight.current = false;
    }
  }

  const title =
    card === 'upgrade'
      ? fillBrief(copy.upgrade.title)
      : fillBrief(card === 'withBrief' ? copy.title.withBrief : copy.title.all);
  const intro =
    card === 'upgrade'
      ? null
      : fillBrief(card === 'withBrief' ? copy.intro.withBrief : copy.intro.all);
  const decline =
    card === 'upgrade'
      ? fillBrief(copy.upgrade.decline)
      : fillBrief(card === 'withBrief' ? copy.decline.withBrief : copy.decline.all);

  return (
    <section
      aria-labelledby="ai-consent-title"
      style={{
        fontFamily: font.sans,
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.xl,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        margin: '16px 0',
      }}
    >
      <h2 id="ai-consent-title" style={{ fontSize: text.lg, margin: 0, color: color.fg }}>
        {title}
      </h2>
      {view.reask && <p style={{ margin: 0, color: color.fg }}>{copy.reask}</p>}
      {intro && <p style={{ margin: 0, color: color.fgSoft }}>{intro}</p>}
      {card !== 'upgrade' && (
        <div>
          <h3 style={{ fontSize: text.md, margin: '0 0 4px', color: color.fg }}>
            {copy.explain.heading}
          </h3>
          <p style={{ margin: 0, color: color.fgSoft }}>{copy.explain.sends}</p>
        </div>
      )}
      {card !== 'all' && (
        <div>
          <h3 style={{ fontSize: text.md, margin: '0 0 4px', color: color.fg }}>
            {fillBrief(copy.brief.heading)}
          </h3>
          <p style={{ margin: 0, color: color.fgSoft }}>{fillBrief(copy.brief.sends)}</p>
        </div>
      )}
      <p style={{ margin: 0, color: color.fgSoft }}>{copy.never}</p>
      <p style={{ margin: 0, color: color.fg }}>{copy.noFetch}</p>
      <p style={{ margin: 0, color: color.fgSoft }}>{copy.who}</p>
      <p style={{ margin: 0, color: color.fgSoft }}>{copy.training}</p>
      <p style={{ margin: 0, color: color.fgSoft }}>{decline}</p>
      <p style={{ margin: 0, color: color.fgMuted }}>{copy.change}</p>
      <Link href="/privacy#ai-processing">{copy.link}</Link>
      {failed && (
        <p role="alert" style={{ margin: 0, color: color.dangerText }}>
          {copy.error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="primary" disabled={decide.isPending} onClick={() => void choose('allow')}>
          {copy.allow}
        </Button>
        <Button tone="default" disabled={decide.isPending} onClick={() => void choose('not_now')}>
          {copy.notNow}
        </Button>
      </div>
    </section>
  );
}
