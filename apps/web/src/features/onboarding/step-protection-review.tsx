'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button, EmptyState, Eyebrow, tokens } from '@declutrmail/shared';
import type { OnboardingProtectionSplit } from '@declutrmail/shared/contracts';

import { useTriageStats } from '@/features/triage/api/use-triage-queue';
import { TriageScreen } from '@/features/triage/triage-screen';
import { TriageUndoTray } from '@/features/triage/triage-undo-tray';
import type { TriageScreenState, TriageSessionStats } from '@/features/triage/data';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';

import { useFirstTriage } from './api/use-onboarding';

const { color, font } = tokens;

/**
 * Step 5 for the `protect_important` goal — a review of the protection
 * DeclutrMail already applied (D245), not a cleanup run.
 *
 * WHY THIS EXISTS. The goal used to protect nothing: the verb registry
 * is Keep/Archive/Unsubscribe/Later/Delete with no Protect verb, and
 * Keep is explicitly not Protect (ADR-0019). Meanwhile automatic
 * protection had already shielded 515 senders on the founder's mailbox
 * before step 5 ever ran. So the honest thing for a user who asked to
 * "protect important senders" is not to protect more — it is to show
 * what we already did and let them correct it.
 *
 * THE SPLIT. Protection from a REPLY is a two-way relationship and
 * needs no review; that count is the reassurance and the headline. A
 * star or a Gmail importance flag is one-way — the user marked a
 * message, not a correspondent — so those are the rows. They are
 * ordered by the unread inbox mail each protection is shielding, so
 * the costliest mistake leads.
 *
 * ALL FIVE VERBS. The rows embed the real `<TriageScreen/>`, so they
 * carry the full K/A/U/L/D toolbar and the D226 lifecycle (sheet →
 * mandatory preview → mutation → undo). A row offering only Unprotect
 * would be the per-surface verb hand-rolling ADR-0019 forbids, and
 * protection scopes to bulk and automatic actions only (CLAUDE.md
 * §2.6) — an explicit single action on a protected sender is allowed
 * and stays allowed. What is ADDED here is a direct Unprotect control,
 * because on this screen changing the safety state is the point.
 *
 * The two acts stay separate: the verbs decide what happens to mail,
 * Unprotect decides the safety state. See `protected-notice.tsx` for
 * why bundling them was rejected.
 */
export function StepProtectionReview({
  onComplete,
  completing,
  corner,
}: {
  /** Finish onboarding (D113 write) and leave for /senders. */
  onComplete: () => void;
  /** True while the completion POST is in flight. */
  completing: boolean;
  corner?: ReactNode;
}) {
  const firstTriage = useFirstTriage();
  const stats = useTriageStats();
  const started = useRef(false);
  const finished = useRef(false);

  useEffect(() => {
    const target = firstTriage.data?.meta.pinned;
    if (target == null || started.current) return;
    started.current = true;
    void track('first_relief_session_started', { goal: 'protect_important', target });
  }, [firstTriage.data?.meta.pinned]);

  const finish = (outcome: 'completed' | 'stopped' | 'empty') => {
    if (finished.current || !firstTriage.data) return;
    finished.current = true;
    void track('first_relief_session_completed', {
      goal: 'protect_important',
      target: firstTriage.data.meta.pinned,
      decided: firstTriage.data.meta.decided,
      outcome,
    });
    onComplete();
  };

  if (firstTriage.isError) {
    return (
      <PanelShell corner={corner}>
        <EmptyState
          title="Couldn't load your protection summary"
          description={
            firstTriage.error instanceof ApiError
              ? "We couldn't read which senders are protected. Try again in a moment."
              : "We couldn't read which senders are protected. Try again in a moment."
          }
          action={
            <Button tone="primary" onClick={() => void firstTriage.refetch()}>
              Try again
            </Button>
          }
        />
      </PanelShell>
    );
  }

  if (firstTriage.isLoading || !firstTriage.data) {
    return (
      <PanelShell corner={corner}>
        <p role="status" style={{ color: color.fgMuted, fontSize: 14 }}>
          Checking what we protected…
        </p>
      </PanelShell>
    );
  }

  const { rows, meta } = firstTriage.data;
  // Absent only if the server took the cleanup branch — the goal
  // changed between this render and that read. Rows still render; the
  // counts simply are not claimed, because we do not have them.
  const split = meta.protection ?? null;
  const reviewed = meta.pinned === 0 || meta.decided >= meta.pinned;

  if (reviewed) {
    const done = donePanel(split, meta.pinned);
    return (
      <PanelShell corner={corner}>
        <Eyebrow>Step 5 of 5 · Review protection</Eyebrow>
        <h1
          style={{
            fontFamily: font.display,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '6px 0 4px',
          }}
        >
          {done.headline}
        </h1>
        <p style={{ color: color.fgMuted, fontSize: 14, margin: '0 0 24px', maxWidth: 500 }}>
          {done.body}
        </p>
        <Button
          tone="primary"
          onClick={() => finish(meta.pinned === 0 ? 'empty' : 'completed')}
          disabled={completing}
          style={{ minWidth: 220 }}
        >
          {completing ? 'Finishing…' : 'Continue to Senders →'}
        </Button>
        {/* Any verb used during the review is still reversible (D35/D58). */}
        <TriageUndoTray />
      </PanelShell>
    );
  }

  const state: TriageScreenState =
    stats.isError || stats.isLoading || !stats.data
      ? // Stats feed only the queue-empty celebration, which this
        // wrapper replaces with its own panel — keep the review usable
        // even if /triage/stats hiccups.
        { kind: 'ready', rows, stats: EMPTY_STATS }
      : { kind: 'ready', rows, stats: stats.data };

  return (
    <div style={{ minHeight: '100vh', background: color.bg }}>
      {/* Wraps rather than crushing. Without `flexWrap` the headline
          block and the two controls share one non-wrapping row, so at
          375px the heading collapsed to a ~200px column — one word per
          line — while "Skip setup for now" ran off the right edge. The
          `flex` basis lets the text take the whole row first and pushes
          the controls onto their own line. */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          maxWidth: 1180,
          margin: '0 auto',
          padding: '20px 24px 0',
          fontFamily: font.sans,
        }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Eyebrow>Step 5 of 5 · Review protection</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              // Scales down on narrow widths so the reassurance still
              // reads as one sentence rather than a stack of words.
              fontSize: 'clamp(18px, 4.4vw, 22px)',
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '6px 0 4px',
            }}
          >
            {reviewHeadline(split)}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: color.fgMuted, maxWidth: 620 }}>
            {reviewBody(split, rows.length)}
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            marginLeft: 'auto',
          }}
        >
          {/* Ends onboarding for good — `finish` writes `onboarded_at`
              and there is no way back into this step. Say that it ends
              the review rather than that it navigates. */}
          <Button tone="ghost" onClick={() => finish('stopped')} disabled={completing}>
            Finish for today
          </Button>
          {corner}
        </div>
      </header>

      <TriageScreen state={state} journey="first_relief" offerUnprotect />
      <TriageUndoTray />
    </div>
  );
}

/* ── Copy ──────────────────────────────────────────────────────────── */

function senders(n: number): string {
  return n === 1 ? '1 sender' : `${n.toLocaleString()} senders`;
}

/**
 * The headline is the reassurance when there IS one. On a mailbox with
 * no replies protected (a real case — one connected account is 0 strong
 * / 2 weak) a "we protected 0" sentence would read as failure, so the
 * headline states the fact that actually exists instead.
 */
function reviewHeadline(split: OnboardingProtectionSplit | null): string {
  if (split === null) return 'Senders we protected for you';
  if (split.strong > 0) return `We protected ${senders(split.strong)} you write back to.`;
  return `${senders(split.weak)} ${split.weak === 1 ? 'is' : 'are'} protected by a single signal.`;
}

function reviewBody(split: OnboardingProtectionSplit | null, shown: number): string {
  const ordering =
    shown === 1
      ? 'Here is the one shielding the most unread mail.'
      : `Here are the ${shown} shielding the most unread mail.`;
  if (split === null) {
    return `Protected senders stay out of bulk and automatic cleanup. ${ordering}`;
  }
  if (split.strong > 0) {
    return (
      `Replying is a two-way relationship, so those stay out of bulk and automatic cleanup ` +
      `without you doing anything. ${senders(split.weak)} ` +
      `${split.weak === 1 ? 'is' : 'are'} protected by one star or a Gmail importance flag — ` +
      `one-way signals, and worth a look. ${ordering}`
    );
  }
  return (
    `None of them came from a reply — a star or a Gmail importance flag marks a message, ` +
    `not a correspondent. Protected senders stay out of bulk and automatic cleanup. ${ordering}`
  );
}

/**
 * The end-of-review panel, headline and body resolved TOGETHER.
 *
 * They were two functions branching independently on the same
 * `(split, pinned)` pair, and they disagreed: the headline read the
 * strong count while the body assumed `pinned === 0` meant nothing was
 * weakly protected. On a mailbox with 55 weak protections and no
 * showable rows that produced "Nothing else is protected on a weaker
 * signal" — and with no strong protections, "Nothing is protected yet".
 *
 * `pinned === 0` is TWO facts, and only the count can tell them apart:
 *
 *   weak === 0  — genuinely nothing to review; the reassurance is the win
 *   weak  >  0  — there IS something to review and we could not line any
 *                 of it up (every candidate decided inside the queue's
 *                 recent-decision window, or not yet scored)
 *
 * Collapsing those two into one message is the same defect this screen
 * exists to avoid: asserting what we do not know.
 */
function donePanel(
  split: OnboardingProtectionSplit | null,
  pinned: number,
): { headline: string; body: string } {
  const stillWeak =
    split !== null && split.weak > 0
      ? `${senders(split.weak)} ${split.weak === 1 ? 'is' : 'are'} still protected by one star ` +
        `or a Gmail importance flag — open any of them from Senders to see the reason and ` +
        `change it.`
      : '';

  if (split === null) {
    return {
      headline: pinned > 0 ? 'Protection reviewed.' : 'Nothing to review.',
      body: 'Continue to Senders to see everything DeclutrMail found.',
    };
  }

  if (pinned > 0) {
    return {
      headline: 'Protection reviewed.',
      body:
        `Protected senders stay out of bulk and automatic cleanup, and anything you moved just ` +
        `now can be undone from Activity.${stillWeak ? ` ${stillWeak}` : ''} Welcome aboard.`,
    };
  }

  // Nothing was shown. Which of the two facts that is depends on `weak`.
  if (split.weak > 0) {
    return {
      headline:
        split.strong > 0
          ? `We protected ${senders(split.strong)} you write back to.`
          : `${senders(split.weak)} ${split.weak === 1 ? 'is' : 'are'} protected by a single signal.`,
      body: `We didn't have a review to line up here, but ${stillWeak}`,
    };
  }

  if (split.strong > 0) {
    return {
      headline: `We protected ${senders(split.strong)} you write back to.`,
      body:
        `They stay out of bulk and automatic cleanup. Nothing else is protected on a weaker ` +
        `signal, so there is nothing here to second-guess.`,
    };
  }

  return {
    headline: 'Nothing is protected yet.',
    body:
      `Protection turns itself on only for strong evidence — three replies, a starred message, ` +
      `or repeated Gmail importance. Nothing in this mailbox has reached that yet, so nothing ` +
      `is being held back from cleanup.`,
  };
}

/* ── Shell ─────────────────────────────────────────────────────────── */

/** Centered shell for the loading / error / completion panels. */
function PanelShell({ corner, children }: { corner?: ReactNode; children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 24px',
        background: color.bg,
        fontFamily: font.sans,
        position: 'relative',
      }}
    >
      {corner && <div style={{ position: 'absolute', top: 20, right: 24 }}>{corner}</div>}
      <div style={{ width: '100%', maxWidth: 560 }}>{children}</div>
    </main>
  );
}

/**
 * Typed zero-stats fallback for the unreachable queue-empty branch —
 * see the inline note where it is used. Not fake UI: it never renders
 * (this wrapper's own panel replaces the empty state).
 */
const EMPTY_STATS: TriageSessionStats = {
  decidedToday: 0,
  archivedToday: 0,
  unsubscribedToday: 0,
  laterToday: 0,
  freeRemaining: null,
  tier: 'free',
};
