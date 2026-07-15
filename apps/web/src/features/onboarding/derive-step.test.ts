import { describe, expect, it } from 'vitest';

import { deriveAuthedStep, type DeriveAuthedStepInput } from './derive-step';

/**
 * Pure step-derivation table (D106 machine, authed half). Every
 * branch is server-state driven — this is the refresh-resume
 * contract: same inputs, same step.
 */

const baseState = (
  data: DeriveAuthedStepInput['state']['data'],
): DeriveAuthedStepInput['state'] => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  retry: () => undefined,
});

const fresh = { onboardedAt: null, goal: null, presetPicks: null };

describe('deriveAuthedStep', () => {
  it('error beats loading (no forever-skeleton on a failed read)', () => {
    const step = deriveAuthedStep({
      state: { ...baseState(undefined), isLoading: true, isError: true, error: new Error('x') },
      hasActiveMailbox: true,
      syncReady: true,
    });
    expect(step.kind).toBe('error');
  });

  it('loading while the state read is in flight', () => {
    const step = deriveAuthedStep({
      state: { ...baseState(undefined), isLoading: true },
      hasActiveMailbox: true,
      syncReady: true,
    });
    expect(step.kind).toBe('loading');
  });

  it('done once onboarded_at is set, regardless of anything else', () => {
    const step = deriveAuthedStep({
      state: baseState({
        onboardedAt: '2026-06-11T00:00:00Z',
        goal: null,
        presetPicks: null,
      }),
      hasActiveMailbox: false,
      syncReady: null,
    });
    expect(step.kind).toBe('done');
  });

  it('connect when authed with no active mailbox', () => {
    const step = deriveAuthedStep({
      state: baseState(fresh),
      hasActiveMailbox: false,
      syncReady: null,
    });
    expect(step.kind).toBe('connect');
  });

  it('loading while sync readiness is unknown (mailbox exists)', () => {
    const step = deriveAuthedStep({
      state: baseState(fresh),
      hasActiveMailbox: true,
      syncReady: null,
    });
    expect(step.kind).toBe('loading');
  });

  it('sync-gate while the initial sync is not ready (strict gate, D6)', () => {
    const step = deriveAuthedStep({
      state: baseState(fresh),
      hasActiveMailbox: true,
      syncReady: false,
    });
    expect(step.kind).toBe('sync-gate');
  });

  it('preset-pick when ready and step 4 not yet submitted (picks null)', () => {
    const step = deriveAuthedStep({
      state: baseState(fresh),
      hasActiveMailbox: true,
      syncReady: true,
    });
    expect(step.kind).toBe('preset-pick');
  });

  it('first-triage when picks submitted — EMPTY picks count as submitted', () => {
    const step = deriveAuthedStep({
      state: baseState({ onboardedAt: null, goal: 'reduce_newsletters', presetPicks: [] }),
      hasActiveMailbox: true,
      syncReady: true,
    });
    expect(step.kind).toBe('first-triage');
  });

  it('returns to goal selection for legacy picks without a goal', () => {
    const step = deriveAuthedStep({
      state: baseState({ onboardedAt: null, goal: null, presetPicks: [] }),
      hasActiveMailbox: true,
      syncReady: true,
    });
    expect(step.kind).toBe('preset-pick');
  });
});
