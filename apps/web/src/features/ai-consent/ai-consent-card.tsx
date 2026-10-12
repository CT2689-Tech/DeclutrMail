'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { Button, toast, tokens } from '@declutrmail/shared';
import type { AiConsentCard as CardKind, AiConsentView } from '@declutrmail/shared/ai-consent';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { track } from '@/lib/posthog';

import { dismissBriefUpgrade } from './ai-prompt-queue';
import { useDecideAiConsent } from './use-decide-ai-consent';

const { color, font, text, radius } = tokens;
const copy = WS2_COPY.aiConsent;

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

/** True when this deck path, or a parent of it, is marked NOT SHIPPING. */
function notShipping(path: string): boolean {
  return copy._notShipping.some(
    (item) => item === path || path.startsWith(`${item}.`) || item.startsWith(`${path}.`),
  );
}

/**
 * One sentence: intro for the explanations card, upgrade.body for Brief.
 * Hidden when that key is blank or marked NOT SHIPPING. No fixed height.
 */
function bodyLine(card: CardKind): string | null {
  const path =
    card === 'upgrade' ? 'upgrade.body' : card === 'withBrief' ? 'intro.withBrief' : 'intro.all';
  if (notShipping(path)) return null;
  const raw =
    card === 'upgrade'
      ? copy.upgrade.body
      : card === 'withBrief'
        ? copy.intro.withBrief
        : copy.intro.all;
  const text = raw.trim();
  return text.length > 0 ? fillBrief(text) : null;
}

function cardTitle(card: CardKind): string {
  if (card === 'upgrade') return fillBrief(copy.upgrade.title);
  return fillBrief(card === 'withBrief' ? copy.title.withBrief : copy.title.all);
}

/**
 * Allow / Not now. Title, one optional body line, and the privacy link.
 * Long deck keys stay in the JSON for imports and are not rendered.
 */
export function AiConsentCard({
  view,
  card,
  onDone,
  onNotNow,
}: {
  view: AiConsentView;
  card: CardKind;
  onDone?: () => void;
  /**
   * When set, Not now runs this instead of storing a decline.
   * The inline nudge uses it for the two-dismissal queue.
   */
  onNotNow?: () => void;
}) {
  const decide = useDecideAiConsent();
  const inflight = useRef(false);
  const [failed, setFailed] = useState(false);
  const body = bodyLine(card);

  useEffect(() => {
    void track('brief_ai_consent_shown', {});
  }, []);

  async function choose(action: 'allow' | 'not_now'): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setFailed(false);
    try {
      await decide.mutateAsync({ action, card });
      if (action === 'not_now' && card === 'upgrade') dismissBriefUpgrade(Date.now());
      void track('brief_ai_consent_decided', { decision: action });
      if (action === 'allow') {
        const toastCopy =
          card === 'upgrade'
            ? fillBrief(copy.brief.allowed)
            : card === 'all'
              ? copy.allowed.toast.all
              : fillBrief(copy.allowed.toast.withBrief);
        toast(toastCopy, 'info');
      }
      onDone?.();
    } catch {
      setFailed(true);
    } finally {
      inflight.current = false;
    }
  }

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
        {cardTitle(card)}
      </h2>
      {view.reask ? <p style={{ margin: 0, color: color.fgSoft }}>{copy.reask}</p> : null}
      {body && <p style={{ margin: 0, color: color.fgSoft }}>{body}</p>}
      <Link className="dm-external-link" href="/privacy#ai-processing">
        {copy.link}
      </Link>
      {failed && (
        <p role="alert" style={{ margin: 0, color: color.dangerText }}>
          {copy.error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="primary" disabled={decide.isPending} onClick={() => void choose('allow')}>
          {copy.allow}
        </Button>
        <Button
          tone="default"
          disabled={decide.isPending}
          onClick={() => {
            if (onNotNow) {
              onNotNow();
              return;
            }
            void choose('not_now');
          }}
        >
          {copy.notNow}
        </Button>
      </div>
    </section>
  );
}
