'use client';

import { useEffect, useState } from 'react';
import { Button, Pill, Skeleton, tokens, useIsAtMost } from '@declutrmail/shared';
import { SelectWell } from '@/features/settings/settings-list';
import { Switch } from '@/features/settings/switch';
import {
  parseTimeToMinutes,
  QuietHoursConfigSchema,
  type QuietHoursConfig,
} from '@declutrmail/shared/contracts';

const { color, font, radius, text } = tokens;

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

const DEFAULT_DRAFT: QuietHoursConfig = {
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
  timezone: 'UTC',
};

export function QuietHoursCard(props: QuietHoursCardProps) {
  const { mailboxEmail, mailboxStatus, state, saving, onSave, onRetry } = props;

  return (
    <section aria-label={`Quiet hours for ${mailboxEmail}`} style={{ display: 'grid', gap: 8 }}>
      <header
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 16 }}
      >
        <span
          style={{
            fontFamily: font.sans,
            fontSize: text.sm,
            fontWeight: 600,
            color: color.fgMuted,
            overflowWrap: 'anywhere',
          }}
        >
          {mailboxEmail}
        </span>
        {mailboxStatus === 'disconnected' && <Pill tone="amber">Disconnected</Pill>}
        {state.kind === 'ready' && state.activeNow && <Pill tone="primary">Quiet now</Pill>}
      </header>

      {state.kind === 'loading' && (
        <div
          style={{ ...groupSurface, display: 'grid', gap: 10, padding: 16 }}
          data-testid="quiet-card-loading"
        >
          <Skeleton width="40%" height={14} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="55%" height={14} />
        </div>
      )}

      {state.kind === 'error' && (
        <div
          role="alert"
          style={{
            ...groupSurface,
            display: 'grid',
            gap: 10,
            padding: 16,
            fontFamily: font.sans,
            fontSize: text.md,
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
          initial={state.config ?? DEFAULT_DRAFT}
          useBrowserDefault={state.config === null}
          saving={saving}
          onSave={onSave}
        />
      )}
    </section>
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
  useBrowserDefault,
  saving,
  onSave,
}: {
  initial: QuietHoursConfig;
  useBrowserDefault: boolean;
  saving: boolean;
  onSave: (config: QuietHoursConfig) => void;
}) {
  const [baseline, setBaseline] = useState<QuietHoursConfig>(initial);
  const [draft, setDraft] = useState<QuietHoursConfig>(initial);
  const [zones, setZones] = useState<string[]>([initial.timezone]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isPhone = useIsAtMost('xs');

  useEffect(() => {
    if (!useBrowserDefault) return;
    const timezone = browserTimeZone();
    const next = { ...initial, timezone };
    setBaseline(next);
    setDraft(next);
    setZones([timezone]);
  }, [initial, useBrowserDefault]);

  const crossesMidnight = parseTimeToMinutes(draft.startLocal) > parseTimeToMinutes(draft.endLocal);
  const dirty =
    draft.enabled !== baseline.enabled ||
    draft.startLocal !== baseline.startLocal ||
    draft.endLocal !== baseline.endLocal ||
    draft.timezone !== baseline.timezone;

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

  const inputStyle = {
    fontFamily: font.sans,
    fontSize: text.md,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    color: color.fg,
    background: color.fill,
    border: 'none',
    borderRadius: radius.sm,
    padding: '0 14px',
    height: isPhone ? 44 : 36,
    boxSizing: 'border-box',
  } as const;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={groupSurface}>
        <Row label="Quiet hours">
          <Switch
            checked={draft.enabled}
            disabled={saving}
            ariaLabel="Quiet hours"
            onChange={(next) => set({ enabled: next })}
          />
        </Row>
        <Row label="Start" divider>
          <input
            type="time"
            value={draft.startLocal}
            disabled={saving}
            onChange={(e) => set({ startLocal: e.target.value })}
            aria-label="Quiet window start"
            style={inputStyle}
          />
        </Row>
        <Row label="End" divider>
          <input
            type="time"
            value={draft.endLocal}
            disabled={saving}
            onChange={(e) => set({ endLocal: e.target.value })}
            aria-label="Quiet window end"
            style={inputStyle}
          />
        </Row>
        <Row label="Timezone" divider>
          <SelectWell
            value={draft.timezone}
            disabled={saving}
            onFocus={() => setZones(timeZoneOptions(draft.timezone))}
            onChange={(e) => set({ timezone: e.target.value })}
            aria-label="Quiet window timezone"
            style={{ maxWidth: isPhone ? 190 : 260, height: isPhone ? 44 : 36 }}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </SelectWell>
        </Row>
      </div>

      {crossesMidnight && (
        <span
          style={{
            fontFamily: font.sans,
            fontSize: text.sm,
            color: color.fgMuted,
            padding: '0 16px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          Crosses midnight — quiet from {draft.startLocal} until {draft.endLocal} the next day.
        </span>
      )}

      {validationError && (
        <span
          role="alert"
          style={{
            fontFamily: font.sans,
            fontSize: text.sm,
            color: color.danger,
            padding: '0 16px',
          }}
        >
          {validationError}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
        <Button tone="primary" size="md" onClick={submit} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save quiet hours'}
        </Button>
        {!dirty && !saving && (
          <span style={{ fontFamily: font.sans, fontSize: text.sm, color: color.fgMuted }}>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

/** The raised group every mailbox's quiet settings sit in (Settings grammar). */
const groupSurface = {
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.xl,
  overflow: 'hidden',
} as const;

/** One 56px settings row: label left, control right, inset hairline above. */
function Row({
  label,
  divider = false,
  children,
}: {
  label: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 56,
        padding: '6px 16px',
        boxSizing: 'border-box',
        backgroundImage: divider
          ? `linear-gradient(${color.lineSoft}, ${color.lineSoft})`
          : undefined,
        backgroundSize: 'calc(100% - 16px) 1px',
        backgroundPosition: 'right top',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <span style={{ fontFamily: font.sans, fontSize: text.md, fontWeight: 500, color: color.fg }}>
        {label}
      </span>
      {children}
    </div>
  );
}
