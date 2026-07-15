'use client';

import type { ReactNode } from 'react';
import { Button, EmptyState, Eyebrow, tokens } from '@declutrmail/shared';

import { useTriageStats } from '@/features/triage/api/use-triage-queue';
import { TriageScreen } from '@/features/triage/triage-screen';
import { TriageUndoTray } from '@/features/triage/triage-undo-tray';
import type { TriageScreenState, TriageSessionStats } from '@/features/triage/data';
import { ApiError } from '@/lib/api/client';

import { useFirstTriage } from './api/use-onboarding';

const { color, font } = tokens;

/**
 * Step 5 — First Triage (D112).
 *
 * A guided 3-decision preview (up to three when fewer candidates exist)
 * that embeds the REAL
 * `<TriageScreen/>` — same row component, same K/A/U/L toolbar, same
 * D226 lifecycle (sheet → mandatory preview → mutation → undo), same
 * undo tray. Nothing here is a sandbox: every decision creates a real
 * action with a real undo token.
 *
 * How rows leave: the first-triage query key extends the triage-queue
 * prefix, so the pipeline's post-confirmation invalidation refetches
 * it; the BE drops senders whose decision is durable (D226 server
 * confirmation — no optimistic removal). Completion = the server-
 * reported `decided === pinned`, never a client-side count.
 *
 * The `pinned === 0` branch is the D112 small-mailbox edge: nothing
 * eligible to practice on (tiny mailbox, or everything already
 * decided) — offer the honest exit instead of an empty queue.
 */
export function StepFirstTriage({
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

  if (firstTriage.isError) {
    const err = firstTriage.error;
    return (
      <PanelShell corner={corner}>
        <EmptyState
          title="Couldn't load your practice run"
          description={
            err instanceof ApiError
              ? `We couldn't load your first-triage candidates (${err.status}). Try again in a moment.`
              : "We couldn't load your first-triage candidates right now. Try again in a moment."
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
          Finding a useful first sender decision…
        </p>
      </PanelShell>
    );
  }

  const { rows, meta } = firstTriage.data;
  const done = meta.pinned === 0 || meta.decided >= meta.pinned;

  if (done) {
    return (
      <PanelShell corner={corner}>
        <Eyebrow>Step 5 of 5 · Guided 3-decision preview</Eyebrow>
        <h1
          style={{
            fontFamily: font.display,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '6px 0 4px',
          }}
        >
          {meta.pinned === 0 ? 'Your inbox is ready.' : 'Your first sender decisions are saved.'}
        </h1>
        <p style={{ color: color.fgMuted, fontSize: 14, margin: '0 0 24px', maxWidth: 460 }}>
          {meta.pinned === 0
            ? "We didn't find a useful first decision right now — open Senders to review the inbox DeclutrMail indexed."
            : `You made ${meta.decided} sender ${meta.decided === 1 ? 'decision' : 'decisions'}. Manual Archive and Later affected matching inbox mail when they ran; they did not create future-mail rules. A delivered unsubscribe request is one-way. Reversible moves remain available in Activity while their token is live. Welcome aboard.`}
        </p>
        <p style={{ color: color.fgMuted, fontSize: 13, margin: '-12px 0 24px', maxWidth: 500 }}>
          Senders stays available after onboarding. On Free, any cleanup actions you have left
          remain available there; ongoing Triage queues require Plus.
        </p>
        <Button tone="primary" onClick={onComplete} disabled={completing} style={{ minWidth: 220 }}>
          {completing ? 'Finishing…' : 'Open your senders →'}
        </Button>
        {/* The undo tray stays reachable on the completion panel — the
            decisions just made must remain reversible (D35/D58). */}
        <TriageUndoTray />
      </PanelShell>
    );
  }

  const state: TriageScreenState =
    stats.isError || stats.isLoading || !stats.data
      ? // Stats only feed the queue-empty celebration screen, which
        // this wrapper replaces with its own completion panel — keep
        // the practice run usable even if /triage/stats hiccups.
        { kind: 'ready', rows, stats: EMPTY_STATS }
      : { kind: 'ready', rows, stats: stats.data };

  return (
    <div style={{ minHeight: '100vh', background: color.bg }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          maxWidth: 1180,
          margin: '0 auto',
          padding: '20px 24px 0',
          fontFamily: font.sans,
        }}
      >
        <div>
          <Eyebrow>Step 5 of 5 · Guided 3-decision preview</Eyebrow>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: color.fgMuted, maxWidth: 560 }}>
            We&rsquo;ll guide you through up to three real sender decisions. Start with{' '}
            {meta.pinned === 1 ? 'this sender' : `these ${meta.pinned} senders`} — decision{' '}
            {Math.min(meta.decided + 1, meta.pinned)} of {meta.pinned}. These are real actions with
            a preview of the affected mail and any available recovery.
          </p>
        </div>
        {corner}
      </header>

      <TriageScreen state={state} />
      <TriageUndoTray />
    </div>
  );
}

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
 * see the inline note where it's used. Not fake UI: it never renders
 * (the wrapper's completion panel replaces the empty state).
 */
const EMPTY_STATS: TriageSessionStats = {
  decidedToday: 0,
  archivedToday: 0,
  unsubscribedToday: 0,
  laterToday: 0,
  streakDays: 0,
  freeRemaining: null,
  futureEmailsSkipped: null,
  minutesSavedPerWeek: null,
  tier: 'free',
};
