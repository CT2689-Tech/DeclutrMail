'use client';

import type { CSSProperties, ReactElement } from 'react';
import { useMemo, useState } from 'react';

import { Button, EmptyState, Pill, ScreenIntro, tokens } from '@declutrmail/shared';

import { ApiError } from '@/lib/api/client';
import type { SecurityEventSeverity, SecurityEventWire } from '@/lib/api/security-events';

import { useSecurityEvents } from './api/use-security-events';

const { color, font } = tokens;

/**
 * AdminSecurityEventsScreen (D181 read surface).
 *
 * Operator-only view of the `security_events` audit log. The route
 * is gated server-side by `AdminAllowlistGuard`; non-allowlisted
 * users receive 404 from the BE and the screen renders the
 * not-an-admin empty state without revealing the route's purpose.
 *
 * Filters: severity (closed enum dropdown), event_type (free-text),
 * time range (datetime-local inputs). Filters compose AND on the BE.
 * Pagination is "Load more" — simpler than infinite scroll for an
 * operator triage flow that typically targets a known event.
 *
 * Privacy (D7, D228): the screen renders ONLY the wire fields the
 * producer emitted — closed-enum reason strings, IP, UA, timestamps.
 * No Gmail message data ever reaches this surface (the producers
 * NEVER include body / snippet / attachment data in the payload).
 */
export function AdminSecurityEventsScreen(): ReactElement {
  const [severity, setSeverity] = useState<SecurityEventSeverity | ''>('');
  const [eventType, setEventType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = useMemo(
    () => ({
      ...(severity ? { severity } : {}),
      ...(eventType ? { eventType } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
      ...(to ? { to: new Date(to).toISOString() } : {}),
    }),
    [severity, eventType, from, to],
  );

  const query = useSecurityEvents(filters);
  const rows = query.data?.rows ?? [];

  return (
    <main style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      <ScreenIntro
        id="admin-security-intro"
        title="Security events"
        body="Operator audit log. Newest first. Closed-enum payloads only — never message content."
      />
      <FilterBar
        severity={severity}
        eventType={eventType}
        from={from}
        to={to}
        onSeverity={setSeverity}
        onEventType={setEventType}
        onFrom={setFrom}
        onTo={setTo}
      />
      <Body query={query} rows={rows} />
    </main>
  );
}

function Body({
  query,
  rows,
}: {
  query: ReturnType<typeof useSecurityEvents>;
  rows: SecurityEventWire[];
}): ReactElement {
  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.error) {
    return <ErrorState error={query.error} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No events match these filters."
        description="Adjust severity / event_type / time range, or clear filters to see the firehose."
      />
    );
  }
  return (
    <>
      <EventsTable rows={rows} />
      {query.data?.hasMore ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
          <Button
            tone="default"
            onClick={() => {
              void query.fetchNextPage();
            }}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

interface FilterBarProps {
  severity: SecurityEventSeverity | '';
  eventType: string;
  from: string;
  to: string;
  onSeverity: (v: SecurityEventSeverity | '') => void;
  onEventType: (v: string) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}

function FilterBar(props: FilterBarProps): ReactElement {
  return (
    <div
      role="region"
      aria-label="Filters"
      style={{
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
        margin: '16px 0',
        padding: '12px',
        background: color.mutedBg,
        borderRadius: '8px',
      }}
    >
      <label style={labelStyle}>
        <span style={labelTextStyle}>Severity</span>
        <select
          value={props.severity}
          onChange={(e) => props.onSeverity(e.target.value as SecurityEventSeverity | '')}
          style={inputStyle}
          aria-label="Filter by severity"
        >
          <option value="">All</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </label>
      <label style={labelStyle}>
        <span style={labelTextStyle}>Event type</span>
        <input
          type="text"
          value={props.eventType}
          onChange={(e) => props.onEventType(e.target.value)}
          placeholder="e.g. login.failure"
          style={{ ...inputStyle, minWidth: '220px' }}
          aria-label="Filter by event type"
        />
      </label>
      <label style={labelStyle}>
        <span style={labelTextStyle}>From</span>
        <input
          type="datetime-local"
          value={props.from}
          onChange={(e) => props.onFrom(e.target.value)}
          style={inputStyle}
          aria-label="From timestamp"
        />
      </label>
      <label style={labelStyle}>
        <span style={labelTextStyle}>To</span>
        <input
          type="datetime-local"
          value={props.to}
          onChange={(e) => props.onTo(e.target.value)}
          style={inputStyle}
          aria-label="To timestamp"
        />
      </label>
    </div>
  );
}

function EventsTable({ rows }: { rows: SecurityEventWire[] }): ReactElement {
  return (
    <div
      style={{
        overflowX: 'auto',
        border: `1px solid ${color.border}`,
        borderRadius: '8px',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: font.sans }}>
        <thead>
          <tr style={{ background: color.mutedBg, textAlign: 'left' }}>
            <th style={thStyle}>Occurred</th>
            <th style={thStyle}>Severity</th>
            <th style={thStyle}>Event type</th>
            <th style={thStyle}>Source IP</th>
            <th style={thStyle}>User agent</th>
            <th style={thStyle}>Payload</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: `1px solid ${color.border}` }}>
              <td style={tdStyle}>
                <time dateTime={r.occurredAt}>{formatTime(r.occurredAt)}</time>
              </td>
              <td style={tdStyle}>
                <SeverityPill severity={r.severity} />
              </td>
              <td style={{ ...tdStyle, fontFamily: font.mono }}>{r.eventType}</td>
              <td style={{ ...tdStyle, fontFamily: font.mono }}>{r.sourceIp ?? '—'}</td>
              <td
                style={{
                  ...tdStyle,
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.userAgent ?? '—'}
              </td>
              <td style={{ ...tdStyle, fontFamily: font.mono, fontSize: '12px' }}>
                {r.payload ? JSON.stringify(r.payload) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeverityPill({ severity }: { severity: SecurityEventSeverity }): ReactElement {
  // Map D181 severity → existing Pill tones (D210 palette):
  //   critical → red    (operator MUST see)
  //   warning  → amber  (operator should look)
  //   info     → default (low-signal noise; surfaceable, not loud)
  const tone = severity === 'critical' ? 'red' : severity === 'warning' ? 'amber' : 'default';
  return <Pill tone={tone}>{severity}</Pill>;
}

function LoadingState(): ReactElement {
  return (
    <div style={{ padding: '32px', textAlign: 'center', color: color.fgMuted }}>
      Loading events…
    </div>
  );
}

function ErrorState({ error }: { error: unknown }): ReactElement {
  // A 404 here means the BE's AdminAllowlistGuard refused the request.
  // The BE intentionally returns 404 (never 403) so the route is
  // indistinguishable from a non-existent one — the FE mirrors that
  // posture with a generic not-found surface rather than a "you don't
  // have access" message that would confirm the route's existence.
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        title="Not found"
        description="This page does not exist or is not available for your account."
      />
    );
  }
  const message =
    error instanceof Error ? error.message : 'Something went wrong loading security events.';
  return <EmptyState title="Couldn't load events" description={message} />;
}

/** Compact UTC display — operator-friendly, no locale surprises. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const labelTextStyle: CSSProperties = {
  fontSize: '12px',
  color: color.fgMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: CSSProperties = {
  padding: '6px 10px',
  border: `1px solid ${color.border}`,
  borderRadius: '6px',
  background: color.card,
  fontFamily: font.sans,
  fontSize: '14px',
};

const thStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '12px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: color.fgMuted,
};

const tdStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '14px',
  color: color.fg,
  verticalAlign: 'top',
};
