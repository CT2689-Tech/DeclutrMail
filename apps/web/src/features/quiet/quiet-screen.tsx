'use client';

import { useEffect } from 'react';

import { EmptyState, ScreenIntro, toast, tokens } from '@declutrmail/shared';
import { parseTimeToMinutes, type QuietHoursConfig } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import { useQuietHours } from './api/use-quiet-hours';
import { useUpdateQuietHours } from './api/use-update-quiet-hours';
import { QuietHoursCard, type QuietHoursCardState } from './quiet-hours-card';

const { color, font } = tokens;

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
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <ScreenIntro
        id="quiet"
        title="Quiet hours"
        body={
          <>
            Pick a daily window per mailbox — while it&apos;s active, Autopilot holds its moves and
            runs them after the window ends. Your own actions always run immediately.
          </>
        }
      />
      {mailboxes.length === 0 ? (
        <EmptyState
          title="No mailboxes connected"
          description="Connect a Gmail account to set quiet hours for it."
        />
      ) : (
        mailboxes.map((mailbox) => <QuietHoursCardContainer key={mailbox.id} mailbox={mailbox} />)
      )}
      <p style={{ fontFamily: font.sans, fontSize: 12, color: color.fgMuted, margin: 0 }}>
        Quiet hours pause Autopilot only — deferred actions run after the window ends. Nothing is
        skipped or dropped.
      </p>
    </div>
  );
}

/** Wires one mailbox's live query + mutation into the dumb card. */
function QuietHoursCardContainer({ mailbox }: { mailbox: MeMailbox }) {
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
    <div style={{ display: 'grid', gap: 8 }}>
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
          activeNow={query.data.activeNow}
          heldCount={query.data.heldCount}
          endsAt={query.data.endsAt}
        />
      )}
    </div>
  );
}

function QuietQueueSummary({
  activeNow,
  heldCount,
  endsAt,
}: {
  activeNow: boolean;
  heldCount: number;
  endsAt: string | null;
}) {
  const actionLabel = heldCount === 1 ? 'Autopilot action' : 'Autopilot actions';
  const endLabel = endsAt ? formatQuietEnd(endsAt) : null;

  let summary = <>Quiet is off. No Autopilot actions are held.</>;

  if (!activeNow && heldCount > 0) {
    summary = (
      <>
        Quiet is off. {heldCount} {actionLabel} {heldCount === 1 ? 'is' : 'are'} awaiting execution;{' '}
        quiet is not delaying {heldCount === 1 ? 'it' : 'them'}.
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
    summary = <>No Autopilot actions are held. No automatic release time is available.</>;
  } else if (activeNow && endLabel) {
    summary = (
      <>
        {heldCount} {actionLabel} {heldCount === 1 ? 'is' : 'are'} held. Quiet ends at{' '}
        <time dateTime={endsAt ?? undefined}>{endLabel}</time>. Autopilot will run{' '}
        {heldCount === 1 ? 'it' : 'them'} afterward.
      </>
    );
  } else if (activeNow) {
    summary = (
      <>
        {heldCount} {actionLabel} {heldCount === 1 ? 'is' : 'are'} held. No automatic release time
        is available; {heldCount === 1 ? 'it' : 'they'} will stay held until quiet ends.
      </>
    );
  }

  return (
    <p
      role="status"
      style={{
        fontFamily: font.sans,
        fontSize: 12,
        lineHeight: 1.5,
        color: color.fgSoft,
        margin: '0 12px',
      }}
    >
      {summary}
    </p>
  );
}

function formatQuietEnd(value: string): string | null {
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(end);
}
