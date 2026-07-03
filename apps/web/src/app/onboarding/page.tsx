'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ToastHost, toast, tokens } from '@declutrmail/shared';
import type { OnboardingFunnelStep } from '@declutrmail/shared/observability';

import { SyncGate, type SyncGateEscape } from '@/features/onboarding/sync-gate';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useSyncGateFunnel } from '@/features/sync/use-sync-funnel';
import {
  useCompleteOnboarding,
  useOnboardingState,
} from '@/features/onboarding/api/use-onboarding';
import { deriveAuthedStep, type AuthedOnboardingStep } from '@/features/onboarding/derive-step';
import { StepConnect } from '@/features/onboarding/step-connect';
import { StepFirstTriage } from '@/features/onboarding/step-first-triage';
import { StepPresetPick } from '@/features/onboarding/step-preset-pick';
import { StepPromise } from '@/features/onboarding/step-promise';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { useMe } from '@/features/auth/api/use-me';
import { useSetActiveMailbox } from '@/features/mailboxes/api/use-set-active-mailbox';
import { ApiError } from '@/lib/api/client';
import { captureFeatureException } from '@/lib/sentry';
import { track } from '@/lib/posthog';

const { color, font } = tokens;

/**
 * Onboarding route — the D106 five-step machine.
 *
 *   1 Promise (D107)  → 2 Connect (D108) → 3 Sync gate (D109/D224)
 *   → 4 Starting rules (D110) → 5 First triage (D112) → done (D113:
 *   `onboarded_at` write + redirect to /senders — first-triage IS the
 *   "land somewhere with real data" moment, and post-sync Senders has
 *   real data immediately, which is why /senders stays the exit).
 *
 * AUTH BOUNDARY (D134 split, restructured here): steps 1+2 render
 * PRE-AUTH — a fresh visitor sees the promise before any Google
 * consent (the old behavior force-bounced them straight to OAuth).
 * The page probes the session with `useMe()` directly; only once a
 * session exists does it mount `AuthProvider` for steps 3+ (where the
 * provider's 401→OAuth bounce is the CORRECT behavior for an expired
 * session). The route's `layout.tsx` is a passthrough.
 *
 * Steps 3-5 are derived from SERVER state only (`derive-step.ts`), so
 * a refresh resumes the right step. The pre-auth promise→connect hop
 * is page-local (no server state exists yet by definition).
 *
 * Two entry shapes, unchanged from before:
 *   - First-run / resumed onboarding → `/onboarding`.
 *   - Secondary connect → `/onboarding?mailbox=<id>` (D116): gates
 *     THAT mailbox with the escape hatch, then exits to /senders —
 *     it is NOT part of the 5-step flow (the user already onboarded).
 *
 * D159 funnel: `onboarding_step_viewed` on step entry,
 * `onboarding_step_completed` (with duration) on step exit; `finished`
 * fires after the completion POST succeeds.
 */
export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlow />
      <ToastHost />
    </Suspense>
  );
}

function OnboardingFlow() {
  const params = useSearchParams();
  const secondaryMailboxId = params.get('mailbox');

  if (secondaryMailboxId) {
    // Secondary-connect gate is an authed surface — an unauthed hit
    // bounces to OAuth start via the provider, exactly as before.
    return (
      <AuthProvider>
        <SecondaryConnectGate mailboxId={secondaryMailboxId} />
      </AuthProvider>
    );
  }
  return <FreshFlow />;
}

/* ── Fresh-flow: pre-auth boundary ─────────────────────────────────── */

function FreshFlow() {
  // Soft session probe — same query key AuthProvider uses, so when a
  // session exists the provider below resolves from cache instantly.
  const me = useMe();
  const [preAuthStep, setPreAuthStep] = useState<'promise' | 'connect'>('promise');

  const unauthed = me.error instanceof ApiError && me.error.status === 401;
  useStepFunnel(unauthed ? (preAuthStep === 'promise' ? 'promise' : 'connect_gmail') : null);

  if (me.isLoading) {
    return <FlowSkeleton label="Checking your session…" />;
  }

  if (unauthed) {
    return preAuthStep === 'promise' ? (
      <StepPromise onConnect={() => setPreAuthStep('connect')} />
    ) : (
      <StepConnect variant="fresh" />
    );
  }

  if (me.error || !me.data) {
    return (
      <FlowError
        message={me.error instanceof Error ? me.error.message : 'Session check failed.'}
        onRetry={() => void me.refetch()}
      />
    );
  }

  return (
    <AuthProvider>
      <AuthedFlow />
    </AuthProvider>
  );
}

/* ── Fresh-flow: authed steps 3-5 ──────────────────────────────────── */

function AuthedFlow() {
  const router = useRouter();
  const { me } = useAuth();
  const state = useOnboardingState();
  const complete = useCompleteOnboarding();

  const activeMailboxId = me.activeMailboxId;
  const sync = useSyncStatus(activeMailboxId ?? undefined, {
    enabled: activeMailboxId != null,
  });
  // D159 sync lifecycle — one started/completed pair per observed
  // initial sync (ref-guarded against the 3s poll re-fires).
  useSyncGateFunnel(sync.data, activeMailboxId);

  const step: AuthedOnboardingStep = deriveAuthedStep({
    state: {
      data: state.data,
      isLoading: state.isLoading,
      isError: state.isError,
      error: state.error,
      retry: () => void state.refetch(),
    },
    hasActiveMailbox: activeMailboxId != null,
    // On a sync-status read ERROR, fall to the gate's queued shape
    // (not the skeleton): the 3s poll keeps retrying, so a transient
    // failure self-heals on screen — same resilience the pre-split
    // page had (`ready = sync.data?.is_ready_for_triage ?? false`).
    syncReady: sync.data ? sync.data.is_ready_for_triage : sync.isError ? false : null,
  });

  useStepFunnel(stepToFunnelStage(step));

  // Exit: onboarding complete (or an already-onboarded user landed
  // here) → the app. /senders has real data immediately post-sync.
  const isDone = step.kind === 'done';
  useEffect(() => {
    if (isDone) {
      router.replace('/senders');
    }
  }, [isDone, router]);

  /** D113 completion (finish or D106 skip) → funnel `finished` → exit. */
  const finish = useCallback(
    (opts: { skipped: boolean }) => {
      if (complete.isPending) return;
      complete.mutate(
        { skipped: opts.skipped },
        {
          onSuccess: () => {
            void track('onboarding_step_completed', { step: 'finished', duration_ms: 0 });
            router.replace('/senders');
          },
          onError: (err) => {
            captureFeatureException(err, { surface: 'onboarding', reason: 'complete' });
            toast("Couldn't finish onboarding — try again.", 'warn');
          },
        },
      );
    },
    [complete, router],
  );

  const skipCorner = (
    <button
      type="button"
      onClick={() => finish({ skipped: true })}
      disabled={complete.isPending}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: font.sans,
        fontSize: 12,
        color: color.fgMuted,
        textDecoration: 'underline',
        padding: 4,
      }}
    >
      Skip setup for now
    </button>
  );

  switch (step.kind) {
    case 'loading':
      return <FlowSkeleton label="Loading your onboarding…" />;
    case 'error':
      return (
        <FlowError
          message={
            step.error instanceof ApiError
              ? `We couldn't load your onboarding state (${step.error.status}).`
              : "We couldn't load your onboarding state."
          }
          onRetry={step.retry}
        />
      );
    case 'done':
      return <FlowSkeleton label="Opening your senders…" />;
    case 'connect':
      // Authed but no active mailbox (aborted OAuth / all disconnected).
      return <StepConnect variant="reconnect" />;
    case 'sync-gate': {
      // First-run strict gate (D6): no escape hatch — there is nothing
      // to return to. Ready flips the derivation to step 4 on its own.
      const status = sync.data ?? {
        readiness_status: 'queued' as const,
        current_stage: 'queued' as const,
        progress_pct: 0,
        is_ready_for_triage: false,
      };
      return <SyncGate status={status} />;
    }
    case 'preset-pick':
      return (
        <StepPresetPick
          presets={state.data?.presets ?? []}
          onSubmitted={() => void state.refetch()}
          corner={skipCorner}
        />
      );
    case 'first-triage':
      return (
        <StepFirstTriage
          onComplete={() => finish({ skipped: false })}
          completing={complete.isPending}
          corner={skipCorner}
        />
      );
  }
}

/* ── Secondary-connect gate (D116) — behavior unchanged ────────────── */

function SecondaryConnectGate({ mailboxId }: { mailboxId: string }) {
  const router = useRouter();
  const { me } = useAuth();
  const setActive = useSetActiveMailbox();

  // Gate THAT mailbox explicitly so it survives the user switching
  // their active mailbox back to the primary mid-sync.
  const sync = useSyncStatus(mailboxId);
  // D159 sync lifecycle for the secondary mailbox's initial sync.
  useSyncGateFunnel(sync.data, mailboxId);
  const ready = sync.data?.is_ready_for_triage ?? false;

  useEffect(() => {
    if (ready) {
      router.replace('/senders');
    }
  }, [ready, router]);

  // Escape hatch only when ANOTHER active mailbox exists to return to.
  const other = me.mailboxes.find((m) => m.status === 'active' && m.id !== mailboxId);
  const escape: SyncGateEscape | undefined = other
    ? {
        returnToEmail: other.email,
        returning: setActive.isPending,
        onReturn: () => {
          setActive.mutate(other.id, { onSuccess: () => router.replace('/senders') });
        },
      }
    : undefined;

  const status = sync.data ?? {
    readiness_status: 'queued' as const,
    current_stage: 'queued' as const,
    progress_pct: 0,
    is_ready_for_triage: false,
  };

  // Not part of the 5-step flow — no step counter in the eyebrow.
  return <SyncGate status={status} escape={escape} eyebrow="One-time scan" />;
}

/* ── Funnel + small states ─────────────────────────────────────────── */

function stepToFunnelStage(step: AuthedOnboardingStep): OnboardingFunnelStep | null {
  switch (step.kind) {
    case 'connect':
      return 'connect_gmail';
    case 'sync-gate':
      return 'sync_gate';
    case 'preset-pick':
      return 'choose_preset';
    case 'first-triage':
      return 'first_triage';
    default:
      return null;
  }
}

/**
 * D159 funnel emitter. On each stage ENTRY fires
 * `onboarding_step_viewed`; when the stage changes, fires
 * `onboarding_step_completed` for the one being left, with the
 * client-measured dwell time.
 */
function useStepFunnel(stage: OnboardingFunnelStep | null): void {
  const current = useRef<{ stage: OnboardingFunnelStep; enteredAt: number } | null>(null);

  useEffect(() => {
    if (stage === current.current?.stage) return;
    const prev = current.current;
    if (prev) {
      void track('onboarding_step_completed', {
        step: prev.stage,
        duration_ms: Date.now() - prev.enteredAt,
      });
    }
    if (stage) {
      void track('onboarding_step_viewed', { step: stage });
      current.current = { stage, enteredAt: Date.now() };
    } else {
      current.current = null;
    }
  }, [stage]);
}

function FlowSkeleton({ label }: { label: string }) {
  return (
    <main
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      <span style={{ color: color.fgMuted, fontSize: 14 }}>{label}</span>
    </main>
  );
}

function FlowError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: color.bg,
        fontFamily: font.sans,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong.</h1>
      <p style={{ color: color.fgMuted, fontSize: 14, margin: 0, maxWidth: 420 }}>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          marginTop: 8,
          padding: '8px 18px',
          borderRadius: 8,
          border: `1px solid ${color.line}`,
          background: color.card,
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: 13,
        }}
      >
        Try again
      </button>
    </main>
  );
}
