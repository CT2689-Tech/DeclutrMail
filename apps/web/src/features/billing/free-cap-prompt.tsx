'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { tokens } from '@declutrmail/shared';

import { useFreeCapStore } from '@/lib/entitlements/free-cap';
import { track } from '@/lib/posthog';

const { color, font, radius, shadow } = tokens;

/**
 * FreeCapPrompt (D19/D77) — the non-blocking upgrade prompt shown when
 * an action enqueue 402s with `FREE_CAP_REACHED` (the Free tier's 5
 * lifetime cleanup actions are spent).
 *
 * Renders nothing until the store reports a hit (see
 * `lib/entitlements/free-cap.ts`); then a dismissible card anchored
 * bottom-center — never a modal, never a route block. The modal-grade
 * upgrade flow lands with the billing FE unit (U13); this is the
 * honest inline affordance until then. Mounted per action surface
 * (Triage, Senders, Sender Detail) — the store is module-global so
 * whichever mount is on-screen renders the same hit.
 */
export function FreeCapPrompt() {
  const hit = useFreeCapStore((s) => s.hit);
  const dismiss = useFreeCapStore((s) => s.dismiss);

  useEffect(() => {
    if (!hit) return;
    void track('upgrade_prompt_shown', { reason: 'free_cap', source: 'actions_402' });
  }, [hit]);

  if (!hit) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="free-cap-prompt"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        maxWidth: 560,
        padding: '12px 16px',
        background: color.card,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.lg,
        boxShadow: shadow.pop,
        fontFamily: font.sans,
        fontSize: 13,
        color: color.fg,
      }}
    >
      <span style={{ textAlign: 'left' }}>
        <strong style={{ fontWeight: 600 }}>
          {hit.requiredUnits > 1 && hit.remaining > 0
            ? `That needs ${hit.requiredUnits} cleanup actions — only ${hit.remaining} of your ${hit.limit} free ones are left.`
            : `You've used all ${hit.limit} free cleanup actions.`}
        </strong>{' '}
        <span style={{ color: color.fgSoft }}>
          Everything you've already cleaned stays done. Upgrade for unlimited cleanup.
        </span>
      </span>
      <Link
        href="/pricing"
        style={{
          flexShrink: 0,
          padding: '6px 12px',
          background: color.primary,
          color: '#fff',
          borderRadius: radius.md,
          fontSize: 12.5,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        See plans
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: color.fgMuted,
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ✕
      </button>
    </div>
  );
}
