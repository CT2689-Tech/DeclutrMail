'use client';

import { useEffect, useState } from 'react';
import { Button, Pill, Skeleton, tokens } from '@declutrmail/shared';
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
 * mutations defer, suggestions the user approved included; actions the
 * user takes directly always run.
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
  /** True from a successful save until the next edit — announced by the save status region. */
  justSaved?: boolean;
  /** Called on every edit, so the screen can end a finished save. */
  onEdit?: () => void;
  onSave: (config: QuietHoursConfig) => void;
  onRetry?: () => void;
}

const noop = () => undefined;

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

/** Stable labels retain the region so similarly named cities stay distinct. */
function timeZoneLabel(zone: string): string {
  const common: Record<string, string> = {
    'America/Los_Angeles': 'Pacific Time (Los Angeles)',
    'America/Denver': 'Mountain Time (Denver)',
    'America/Chicago': 'Central Time (Chicago)',
    'America/New_York': 'Eastern Time (New York)',
    'Asia/Kolkata': 'India Time (Kolkata)',
    'Asia/Calcutta': 'India Time (Kolkata)',
    UTC: 'Coordinated Universal Time (UTC)',
  };
  if (common[zone]) return common[zone];
  const [region, ...city] = zone.split('/');
  return city.length ? `${city.join(' / ').replaceAll('_', ' ')} (${region})` : zone;
}

/** English UI uses the same 12-hour convention as the form's language. */
function displayTime(value: string): string {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Present for assistive tech, invisible on screen. */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

const DEFAULT_DRAFT: QuietHoursConfig = {
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
  timezone: 'UTC',
};

export function QuietHoursCard(props: QuietHoursCardProps) {
  const {
    mailboxEmail,
    mailboxStatus,
    state,
    saving,
    justSaved = false,
    onEdit = noop,
    onSave,
    onRetry,
  } = props;

  return (
    <section aria-label={`Quiet hours for ${mailboxEmail}`} style={{ display: 'grid', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
          announced={justSaved}
          onEdit={onEdit}
          onSave={onSave}
        />
      )}

      {/* Outside the keyed form, which remounts on every save: a live region
          has to exist before its text changes to be announced. */}
      <span role="status" aria-label={`Save status for ${mailboxEmail}`} style={visuallyHidden}>
        {state.kind === 'ready' && justSaved ? 'Saved' : ''}
      </span>
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
  announced,
  onEdit,
  onSave,
}: {
  initial: QuietHoursConfig;
  useBrowserDefault: boolean;
  saving: boolean;
  /** The save status region is saying "Saved" right now. */
  announced: boolean;
  onEdit?: () => void;
  onSave: (config: QuietHoursConfig) => void;
}) {
  const [baseline, setBaseline] = useState<QuietHoursConfig>(initial);
  const [draft, setDraft] = useState<QuietHoursConfig>(initial);
  const [zones, setZones] = useState<string[]>([initial.timezone]);
  const [validationError, setValidationError] = useState<string | null>(null);

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
    onEdit?.();
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
    ...tokens.field,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 0,
    width: 152,
  } as const;

  return (
    <div style={{ display: 'grid', gap: 12 }} lang="en-US">
      <style>{`
        .dm-quiet-timezone-control { min-width: 0; width: min(100%, 360px); flex: 1 1 240px; }
        .dm-quiet-timezone-control > span { display: flex; width: 100%; }
      `}</style>
      <div style={groupSurface}>
        <Row label="Enable quiet hours">
          <Switch
            checked={draft.enabled}
            disabled={saving}
            ariaLabel="Enable quiet hours"
            onChange={(next) => set({ enabled: next })}
          />
        </Row>
        <Row label="Start" divider>
          <input
            className="dm-field"
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
            className="dm-field"
            type="time"
            value={draft.endLocal}
            disabled={saving}
            onChange={(e) => set({ endLocal: e.target.value })}
            aria-label="Quiet window end"
            style={inputStyle}
          />
        </Row>
        <Row label="Timezone" divider className="dm-quiet-timezone-row">
          <div className="dm-quiet-timezone-control">
            <SelectWell
              value={draft.timezone}
              disabled={saving}
              onFocus={() => setZones(timeZoneOptions(draft.timezone))}
              onChange={(e) => set({ timezone: e.target.value })}
              aria-label="Quiet window timezone"
              style={{ width: '100%', maxWidth: '100%' }}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {timeZoneLabel(z)}
                </option>
              ))}
            </SelectWell>
            <span
              style={{
                display: 'block',
                marginTop: 8,
                fontSize: text.sm,
                color: color.fgMuted,
                overflowWrap: 'anywhere',
              }}
            >
              {timeZoneLabel(draft.timezone)}
            </span>
          </div>
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
          Ends at {displayTime(draft.endLocal)} the next day.
        </span>
      )}

      {validationError && (
        <span
          role="alert"
          style={{
            fontFamily: font.sans,
            fontSize: text.sm,
            color: color.dangerText,
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
        {/* `useBrowserDefault` means no config is stored yet: nothing is saved.
            While the save status region says "Saved", screen readers hear it
            there, so they do not hear it twice. */}
        {!dirty && !saving && !useBrowserDefault && (
          <span
            aria-hidden={announced || undefined}
            style={{ fontFamily: font.sans, fontSize: text.sm, color: color.fgMuted }}
          >
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
  className,
  children,
}: {
  label: string;
  divider?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
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
