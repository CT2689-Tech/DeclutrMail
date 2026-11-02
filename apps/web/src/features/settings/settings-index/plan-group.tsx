'use client';

import { Button, tokens } from '@declutrmail/shared';
import { BILLING_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { DrillRow, SettingsGroup } from '../settings-list';

const { color, text } = tokens;

export type PlanGroupState =
  | { kind: 'loading' }
  /** 503 BILLING_DISABLED. The plan is still `me`'s; only the billing read is off. */
  | { kind: 'disabled'; planName: string }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; planName: string; foundingMember: boolean };

/**
 * Settings → Plan: one row to Plan & billing, naming the plan. A failed
 * billing read never replaces account controls; it adds a Retry here.
 */
export function PlanGroup({ state }: { state: PlanGroupState }) {
  const value =
    state.kind === 'ready'
      ? state.foundingMember
        ? `${state.planName} · Founding member`
        : state.planName
      : state.kind === 'disabled'
        ? state.planName
        : null;
  return (
    <SettingsGroup
      title="Plan"
      footer={
        state.kind === 'error' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 12,
            }}
          >
            <p role="alert" style={{ margin: 0, fontSize: text.sm, color: color.dangerText }}>
              Could not load your plan.
            </p>
            <Button tone="default" onClick={state.onRetry} style={{ minHeight: 44 }}>
              Retry
            </Button>
          </div>
        ) : null
      }
    >
      <DrillRow href="/billing" label={BILLING_NAME} {...(value ? { value } : {})} />
    </SettingsGroup>
  );
}
