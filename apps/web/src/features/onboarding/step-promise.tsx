'use client';

import { Button, PrivacyBadge, tokens } from '@declutrmail/shared';

import { StepShell } from './step-shell';

const { color } = tokens;

/**
 * Step 1 — the Promise screen (D107).
 *
 * Pre-OAuth, no inputs: the value promise plus the exact privacy
 * boundary BEFORE any Google consent screen. The trust badge is the
 * shared `PrivacyBadge` (locked D228 copy — "Full bodies fetched: 0"
 * + the explicit storage list; the pre-D228 wording in D107's
 * original body is superseded by the GRILL2 patch on D109).
 *
 * Renders UNAUTHED by design — this is where fresh visitors entering
 * the app funnel land, so there must be no `/api/auth/me` gate in
 * front of it (the page mounts AuthProvider only for steps 3+).
 */
export function StepPromise({ onConnect }: { onConnect: () => void }) {
  return (
    <StepShell
      eyebrow="Step 1 of 5 · Before we connect"
      title="Control Gmail by sender, not by email."
      sub="Before you connect, here is exactly what DeclutrMail will and will not access."
    >
      <PrivacyBadge style={{ width: '100%', textAlign: 'left', marginBottom: 24 }} />

      <Button tone="primary" onClick={onConnect} style={{ minWidth: 220 }}>
        Connect Gmail →
      </Button>

      <p style={{ color: color.fgMuted, fontSize: 12, marginTop: 16 }}>
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
