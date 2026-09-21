'use client';

import { tokens } from '@declutrmail/shared';

const { color, font, radius } = tokens;

/**
 * When to show the post-sync first-cleanup nudge on Senders.
 *
 * Unknown (`hasCompletedCleanup` absent or still loading) stays off —
 * a rolling-deploy skew or a failed summary must not invent a "you
 * have not cleaned up" claim. Syncing / failed mailboxes are not
 * ready, so they keep their own empty states. A mailbox with no
 * visible senders has nothing to pick.
 *
 * Independent of `users.onboarded_at`. That stamp is the onboarding
 * flow finishing (D113), including skip / "Finish for today" / an
 * empty first-triage pin — not "a Gmail-changing action completed".
 */
export function shouldShowFirstCleanupNudge(args: {
  mailboxReady: boolean;
  hasCompletedCleanup: boolean | undefined;
  visibleSenderCount: number;
}): boolean {
  return args.mailboxReady && args.hasCompletedCleanup === false && args.visibleSenderCount > 0;
}

/**
 * Post-sync surface for a ready mailbox that has senders but no
 * completed `action_jobs`. Nudge only — the list stays on screen so
 * the user can pick the sender themselves. Copy budget: title + one
 * sentence + one action.
 */
export function FirstCleanupNudge({ href }: { href: string }) {
  return (
    <div
      role="region"
      aria-label="Finish first cleanup"
      data-testid="first-cleanup-nudge"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        background: color.primaryWash,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: radius.md,
        fontFamily: font.sans,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: color.fg, marginBottom: 2 }}>
          Pick one sender
        </div>
        <p style={{ fontSize: 12.5, color: color.fg, lineHeight: 1.5, margin: 0 }}>
          Open a sender you recognize and finish your first cleanup.
        </p>
      </div>
      <a
        href={href}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 32,
          padding: '0 14px',
          background: color.primary,
          color: color.fgInverse,
          borderRadius: 7,
          fontFamily: font.sans,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        Open a sender
      </a>
    </div>
  );
}
