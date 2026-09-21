'use client';

import { Button, PrivacyBadge, tokens } from '@declutrmail/shared';

import { StepShell } from './step-shell';

const { color, text } = tokens;

/**
 * Step 1 — the Promise screen (D107).
 *
 * Pre-OAuth, no inputs: the value promise plus the exact privacy
 * boundary BEFORE any Google consent screen. The trust badge is the
 * shared `PrivacyBadge` (locked D228 plain-language privacy promise
 * + the explicit storage list; the pre-D228 wording in D107's
 * original body is superseded by the GRILL2 patch on D109).
 *
 * Renders UNAUTHED by design — this is where fresh visitors entering
 * the app funnel land, so there must be no `/api/auth/me` gate in
 * front of it (the page mounts AuthProvider only for steps 3+).
 */
export function StepPromise({ onConnect }: { onConnect: () => void }) {
  return (
    <StepShell title="Clear thousands of emails by sender — and see exactly what moves.">
      {/* The privacy boundary, stated once, at the decision point —
          directly above the button that starts Google consent. */}
      <PrivacyBadge
        style={{ width: '100%', textAlign: 'left', margin: '16px 0 24px', boxShadow: 'none' }}
      />

      <Button tone="primary" size="lg" onClick={onConnect} style={{ minWidth: 220, height: 44 }}>
        Connect Gmail
      </Button>

      <p style={{ color: color.fgMuted, fontSize: text.sm, marginTop: 16 }}>
        <a href="/privacy" style={{ color: color.fgMuted }}>
          Privacy policy
        </a>
        {' · '}
        <a href="/terms" style={{ color: color.fgMuted }}>
          Terms
        </a>
      </p>
    </StepShell>
  );
}
