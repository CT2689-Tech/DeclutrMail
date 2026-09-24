'use client';

import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
  EditorialDescription,
} from '@/features/editorial/page';

import { useEffect } from 'react';
import Link from 'next/link';

import { EmptyState, ScreenIntro, toast, tokens } from '@declutrmail/shared';
import { parseTimeToMinutes, type QuietHoursConfig } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import { useQuietHours } from './api/use-quiet-hours';
import { useUpdateQuietHours } from './api/use-update-quiet-hours';
import { QuietHoursCard, type QuietHoursCardState } from './quiet-hours-card';

const { color, font, text } = tokens;

/**
 * Quiet screen (U18 — D92/D95/D96-partial).
 *
 * V2 scope: per-mailbox quiet-hours WINDOW config (one recurring daily
 * window: start/end local + timezone + enabled). While the window
 * covers now, Autopilot mutations defer (`AutopilotActionWorker`
 * Guard 1); manual actions always run. Out of scope at this unit (the
 * rest of D92-D98): the ad-hoc "Quiet until" toggle, the held-messages
 * list (D96), multi-window schedules with day bitmasks, and the D190
 * preview mode — those land with the QuietHold/QuietRelease pipeline.
 *
 * Per D95 quiet is PER MAILBOX: one card per connected account, each
 * backed by its own query/mutation pair.
 */
export function QuietRoute() {
  const { me } = useAuth();
  const mailboxes = me.mailboxes;

  // `mailbox_id: null` — this page renders one card per connected
  // mailbox (D95), so no single mailbox scopes the view; PostHog
  // `identify` ties the event to the user.
  useEffect(() => {
    void track('page_viewed', { page: 'quiet', mailbox_id: null });
  }, []);

  return (
    <div
      style={{
        ...editorialColumnStyle,
        display: 'grid',
        gap: 24,
      }}
    >
      <EditorialKicker>Automations / On your schedule</EditorialKicker>
      <h1 style={editorialTitleStyle}>Quiet hours</h1>
      <EditorialDescription>
        Schedules for all connected inboxes. Autopilot pauses during each inbox’s quiet hours; Gmail
        delivery and your own actions continue.
      </EditorialDescription>
      <ScreenIntro
        id="quiet"
        title="Quiet hours"
        body="Autopilot pauses during quiet hours. Your own actions still run."
      />
      {mailboxes.length === 0 ? (
        <EmptyState
          title="No mailboxes connected"
          description="Connect a Gmail account to set quiet hours for it."
        />
      ) : (
        <div style={{ display: 'grid', gap: 32, maxWidth: 720 }}>
          {mailboxes.map((mailbox) => (
            <QuietHoursCardContainer
              key={mailbox.id}
              mailbox={mailbox}
              active={mailbox.id === me.activeMailboxId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Wires one mailbox's live query + mutation into the dumb card. */
function QuietHoursCardContainer({ mailbox, active }: { mailbox: MeMailbox; active: boolean }) {
  const query = useQuietHours(mailbox.id);
  const update = useUpdateQuietHours(mailbox.id);

  const state: QuietHoursCardState = query.isLoading
    ? { kind: 'loading' }
    : query.isError
      ? {
          kind: 'error',
          message: "We couldn't load quiet hours right now.",
        }
      : {
          kind: 'ready',
          config: query.data?.config ?? null,
          activeNow: query.data?.activeNow ?? false,
        };

  const onSave = (config: QuietHoursConfig) => {
    addBreadcrumb({
      category: 'action',
      message: 'quiet: hours saved',
      level: 'info',
    });
    update.mutate(config, {
      onSuccess: () => {
        // Server-confirmed save — never optimistic (taxonomy contract).
        void track('quiet_hours_updated', {
          mailbox_id: mailbox.id,
          enabled: config.enabled,
          crosses_midnight:
            parseTimeToMinutes(config.startLocal) > parseTimeToMinutes(config.endLocal),
        });
        toast(`Quiet hours saved for ${mailbox.email}.`, 'success');
      },
      onError: (err) => {
        captureFeatureException(err, { surface: 'quiet', reason: 'save_hours_failed' });
        toast('Saving failed. Try again.', 'warn');
      },
    });
  };

  return (
    // One raised settings group per mailbox, its address as the group title.
    <div style={{ display: 'grid', gap: 8 }}>
      {active && <p style={{ margin: 0, color: color.primary, fontSize: text.sm }}>Active inbox</p>}
      <QuietHoursCard
        mailboxEmail={mailbox.email}
        mailboxStatus={mailbox.status}
        state={state}
        saving={update.isPending}
        onSave={onSave}
        onRetry={() => void query.refetch()}
      />
      {query.data && (
        <QuietQueueSummary
          activeInbox={active}
          activeNow={query.data.activeNow}
          heldCount={query.data.heldCount}
          endsAt={query.data.endsAt}
          timezone={query.data.config?.timezone ?? 'UTC'}
        />
      )}
    </div>
  );
}

function QuietQueueSummary({
  activeInbox,
  activeNow,
  heldCount,
  endsAt,
  timezone,
}: {
  activeInbox: boolean;
  activeNow: boolean;
  heldCount: number;
  endsAt: string | null;
  timezone: string;
}) {
  const actionLabel = heldCount === 1 ? 'Autopilot action' : 'Autopilot actions';
  const endLabel = endsAt ? formatQuietEnd(endsAt, timezone) : null;

  // Off with nothing held: the unchecked toggle already says it.
  if (!activeNow && heldCount === 0) return null;

  let summary = <>No Autopilot actions are held.</>;

  if (!activeNow) {
    summary = (
      <>
        {heldCount} {actionLabel} waiting to run — not held by quiet hours.
      </>
    );
  } else if (activeNow && heldCount === 0 && endLabel) {
    summary = (
      <>
        No Autopilot actions are held. Quiet ends at{' '}
        <time dateTime={endsAt ?? undefined}>{endLabel}</time>.
      </>
    );
  } else if (activeNow && heldCount === 0) {
    summary = <>No Autopilot actions are held.</>;
  } else if (activeNow && endLabel) {
    summary = (
      <>
        {heldCount} {actionLabel} {heldCount === 1 ? 'is' : 'are'} held until quiet ends at{' '}
        <time dateTime={endsAt ?? undefined}>{endLabel}</time>.
      </>
    );
  } else if (activeNow) {
    summary = (
      <>
        {heldCount} {actionLabel} {heldCount === 1 ? 'is' : 'are'} held until quiet ends.
      </>
    );
  }

  return (
    <p
      role="status"
      style={{
        fontFamily: font.sans,
        fontSize: text.sm,
        lineHeight: 1.5,
        color: color.fgMuted,
        margin: 0,
        padding: '0 16px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {summary}{' '}
      {activeInbox ? (
        <Link href="/autopilot" style={{ color: color.primary }}>
          Review Autopilot rules →
        </Link>
      ) : (
        <span>Choose this inbox in the account menu to review its rules.</span>
      )}
    </p>
  );
}

function formatQuietEnd(value: string, timezone: string): string | null {
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: timezone,
  }).format(end);
}
