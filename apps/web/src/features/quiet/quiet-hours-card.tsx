'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Pill, Skeleton, tokens } from '@declutrmail/shared';
import {
  parseTimeToMinutes,
  QuietHoursConfigSchema,
  type QuietHoursConfig,
} from '@declutrmail/shared/contracts';

const { color, font } = tokens;

/**
 * Per-mailbox quiet-hours config card (U18 — D92/D95).
 *
 * Prop-driven and render-only at the data boundary — the container in
 * `quiet-screen.tsx` wires the live query + mutation; Storybook
 * stories and tests drive this component directly. The card owns the
 * FORM draft (local state) so typing never round-trips the server.
 *
 * One recurring daily window per mailbox: local start/end ("HH:MM") in
 * an IANA timezone. `startLocal > endLocal` = crosses midnight (the
 * "ends next day" hint renders). While the window covers now, Autopilot
 * mutations defer; manual actions always run (user intent wins).
 */

export type QuietHoursCardState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; config: QuietHoursConfig | null; activeNow: boolean };

export interface QuietHoursCardProps {
  mailboxEmail: string;
  mailboxStatus: 'active' | 'disconnected';
  state: QuietHoursCardState;
  /** True while the PUT is in flight — disables the form. */
  saving: boolean;
  onSave: (config: QuietHoursConfig) => void;
  onRetry?: () => void;
}

/** Browser timezone, with a safe fallback. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** IANA zone list for the select; falls back to the current value. */
function timeZoneOptions(current: string): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes(current) ? zones : [current, ...zones];
  } catch {
    return [current];
  }
}

const DEFAULT_DRAFT = (): QuietHoursConfig => ({
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
  timezone: browserTimeZone(),
});

export function QuietHoursCard(props: QuietHoursCardProps) {
  const { mailboxEmail, mailboxStatus, state, saving, onSave, onRetry } = props;

  return (
    <Card padding={20} style={{ display: 'grid', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 14,
            fontWeight: 600,
            color: color.fg,
            overflowWrap: 'anywhere',
          }}
        >
          {mailboxEmail}
        </span>
        {mailboxStatus === 'disconnected' && <Pill tone="amber">Disconnected</Pill>}
        {state.kind === 'ready' && state.activeNow && <Pill tone="primary">Quiet now</Pill>}
      </header>

      {state.kind === 'loading' && (
        <div style={{ display: 'grid', gap: 10 }} data-testid="quiet-card-loading">
          <Skeleton width="40%" height={14} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="55%" height={14} />
        </div>
      )}

      {state.kind === 'error' && (
        <div
          role="alert"
          style={{
            display: 'grid',
            gap: 10,
            fontFamily: font.sans,
            fontSize: 13,
            color: color.fgSoft,
          }}
        >
          <span>{state.message}</span>
          {onRetry && (
            <span>
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            </span>
          )}
        </div>
      )}

      {state.kind === 'ready' && (
        <QuietHoursForm
          key={configKey(state.config)}
          initial={state.config ?? DEFAULT_DRAFT()}
          saving={saving}
          onSave={onSave}
        />
      )}
    </Card>
  );
}

/** Remount the form when the SERVER config changes (post-save refresh). */
function configKey(config: QuietHoursConfig | null): string {
  return config
    ? `${config.enabled}|${config.startLocal}|${config.endLocal}|${config.timezone}`
    : 'unconfigured';
}

function QuietHoursForm({
  initial,
  saving,
  onSave,
}: {
  initial: QuietHoursConfig;
  saving: boolean;
  onSave: (config: QuietHoursConfig) => void;
}) {
  const [draft, setDraft] = useState<QuietHoursConfig>(initial);
  const [validationError, setValidationError] = useState<string | null>(null);

  const zones = useMemo(() => timeZoneOptions(draft.timezone), [draft.timezone]);
  const crossesMidnight = parseTimeToMinutes(draft.startLocal) > parseTimeToMinutes(draft.endLocal);
  const dirty =
    draft.enabled !== initial.enabled ||
    draft.startLocal !== initial.startLocal ||
    draft.endLocal !== initial.endLocal ||
    draft.timezone !== initial.timezone;

  const set = (patch: Partial<QuietHoursConfig>) => {
    setValidationError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = () => {
    const parsed = QuietHoursConfigSchema.safeParse(draft);
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? 'The quiet window is invalid — check the times.',
      );
      return;
    }
    onSave(parsed.data);
  };

  const labelStyle = {
    fontFamily: font.sans,
    fontSize: 12,
    fontWeight: 500,
    color: color.fgSoft,
    display: 'grid',
    gap: 4,
  } as const;
  const inputStyle = {
    fontFamily: font.sans,
    fontSize: 13,
    color: color.fg,
    background: color.card,
    border: `1px solid ${color.line}`,
    borderRadius: 7,
    padding: '6px 8px',
    height: 32,
    boxSizing: 'border-box',
  } as const;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.sans,
          fontSize: 13,
          color: color.fg,
          width: 'fit-content',
          cursor: saving ? 'default' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={saving}
          onChange={(e) => set({ enabled: e.target.checked })}
          style={{ width: 16, height: 16, accentColor: color.primary }}
        />
        Quiet hours on
      </label>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={labelStyle}>
          Start
          <input
            type="time"
            value={draft.startLocal}
            disabled={saving}
            onChange={(e) => set({ startLocal: e.target.value })}
            aria-label="Quiet window start"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          End
          <input
            type="time"
            value={draft.endLocal}
            disabled={saving}
            onChange={(e) => set({ endLocal: e.target.value })}
            aria-label="Quiet window end"
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, minWidth: 200, flex: '1 1 200px' }}>
          Timezone
          <select
            value={draft.timezone}
            disabled={saving}
            onChange={(e) => set({ timezone: e.target.value })}
            aria-label="Quiet window timezone"
            style={{ ...inputStyle, width: '100%' }}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>

      {crossesMidnight && (
        <span style={{ fontFamily: font.sans, fontSize: 12, color: color.fgMuted }}>
          Crosses midnight — quiet from {draft.startLocal} until {draft.endLocal} the next day.
        </span>
      )}

      {validationError && (
        <span role="alert" style={{ fontFamily: font.sans, fontSize: 12, color: color.red }}>
          {validationError}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button tone="primary" size="md" onClick={submit} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save quiet hours'}
        </Button>
        {!dirty && !saving && (
          <span style={{ fontFamily: font.sans, fontSize: 12, color: color.fgMuted }}>Saved</span>
        )}
      </div>
    </div>
  );
}
