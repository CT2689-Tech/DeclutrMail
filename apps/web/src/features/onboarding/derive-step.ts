/**
 * Pure derivation of the AUTHED onboarding step (D106 machine, steps
 * 3-5 + exits). Mirrors the `compose-state.ts` pattern: the route
 * composes live query results into one closed union the renderer
 * switches on, and a refresh resumes the correct step because every
 * branch reads SERVER state — nothing here depends on client history.
 *
 * The two PRE-AUTH steps (1 promise, 2 connect — D107/D108) are not
 * derived here: before a session exists there is no server state, so
 * the page handles them with a local promise→connect toggle.
 *
 * Branch order:
 *   1. error    — the state read failed (surface a real error, never
 *                 a forever-skeleton; launch-gap audit class).
 *   2. loading  — state still in flight.
 *   3. done     — `onboarded_at` set ⇒ leave the flow (D113).
 *   4. connect  — authed but no active mailbox (every mailbox
 *                 disconnected, or a signup that aborted OAuth) ⇒
 *                 re-offer the connect step.
 *   5. sync-gate— active mailbox not ready ⇒ strict gate (D6/D109).
 *   6. preset-pick — step 4 not submitted (`presetPicks === null`;
 *                 `[]` is a valid "no rules" submission and advances).
 *   7. first-triage — everything else: ready + picks submitted.
 */

export type AuthedOnboardingStep =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'done' }
  | { kind: 'connect' }
  | { kind: 'sync-gate' }
  | { kind: 'preset-pick' }
  | { kind: 'first-triage' };

export interface DeriveAuthedStepInput {
  /** `GET /api/onboarding/state` result projection. */
  state: {
    data:
      | { onboardedAt: string | null; goal: string | null; presetPicks: readonly string[] | null }
      | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    retry: () => void;
  };
  /** Whether the session has an active mailbox to gate/sync. */
  hasActiveMailbox: boolean;
  /** The active mailbox's `is_ready_for_triage`; null while unknown. */
  syncReady: boolean | null;
}

export function deriveAuthedStep(input: DeriveAuthedStepInput): AuthedOnboardingStep {
  const { state } = input;
  if (state.isError) {
    return { kind: 'error', error: state.error, retry: state.retry };
  }
  if (state.isLoading || !state.data) {
    return { kind: 'loading' };
  }
  if (state.data.onboardedAt !== null) {
    return { kind: 'done' };
  }
  if (!input.hasActiveMailbox) {
    return { kind: 'connect' };
  }
  if (input.syncReady === null) {
    return { kind: 'loading' };
  }
  if (!input.syncReady) {
    return { kind: 'sync-gate' };
  }
  if (state.data.goal === null || state.data.presetPicks === null) {
    return { kind: 'preset-pick' };
  }
  return { kind: 'first-triage' };
}
