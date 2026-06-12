'use client';

import { Button, Eyebrow, tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * Under-tier state for /screener (D77) — Free/Plus workspaces see the
 * upgrade surface instead of the queue. Copy honours D194: the
 * Screener COLLECTS new senders for review — it never claims to keep
 * them out of the inbox (D72 soft quarantine; Gmail untouched until
 * the user decides). The Free/Plus deferred-decision path (the Later
 * verb in Triage) is named so the basic queue isn't hidden.
 */
export function ScreenerProUpsell({ onSeePricing }: { onSeePricing: () => void }) {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: '48px auto 0',
        padding: '28px 28px 24px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 12,
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Eyebrow>Screener · Pro</Eyebrow>
      <h2
        style={{
          fontFamily: font.display,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          margin: 0,
        }}
      >
        A queue of new senders, ready when you are.
      </h2>
      <p style={{ fontSize: 13, color: color.fgSoft, lineHeight: 1.6, margin: 0 }}>
        With Pro, the Screener collects every first-time sender for your review — they still arrive
        in your inbox until you decide, and nothing moves without your say-so. Decide once with
        Keep, Archive, Unsubscribe, Later, or Delete, and the sidebar badge tells you when someone
        new shows up.
      </p>
      <p style={{ fontSize: 12.5, color: color.fgMuted, lineHeight: 1.6, margin: 0 }}>
        On your current plan, you can still defer any sender from Triage with{' '}
        <strong>Later (L)</strong> — it parks their mail in the DeclutrMail/Later label until
        you&apos;re ready.
      </p>
      <div>
        <Button tone="primary" onClick={onSeePricing}>
          See Pro plans
        </Button>
      </div>
    </div>
  );
}
