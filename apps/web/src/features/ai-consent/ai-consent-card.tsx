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

/**
 * Short body, when Content has put one on the deck. Hidden when the key
 * is absent, blank, or listed as NOT SHIPPING. No fixed height.
 */
function bodyLine(card: CardKind): string | null {
  if (copy._notShipping.some((path) => path === 'body' || path.startsWith('body.'))) return null;
  const body = (copy as { body?: string | { all?: string; withBrief?: string; upgrade?: string } })
    .body;
  if (body == null) return null;
  const raw =
    typeof body === 'string'
      ? body
      : card === 'upgrade'
        ? (body.upgrade ?? '')
        : card === 'withBrief'
          ? (body.withBrief ?? body.all ?? '')
          : (body.all ?? '');
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
  view: _view,
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
        <Button tone="default" disabled={decide.isPending} onClick={() => void choose('not_now')}>
          {copy.notNow}
        </Button>
      </div>
    </section>
  );
}
