'use client';

import { EmptyState, ScreenIntro, toast, tokens } from '@declutrmail/shared';
import { parseTimeToMinutes, type QuietHoursConfig } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { ApiError } from '@/lib/api/client';
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
          message:
            query.error instanceof ApiError
              ? `We couldn't load quiet hours (HTTP ${query.error.status}).`
              : "We couldn't load quiet hours right now.",
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
        const message =
          err instanceof ApiError
            ? `Saving failed (HTTP ${err.status}). Try again.`
            : 'Saving failed. Try again.';
        toast(message, 'warn');
      },
    });
  };

  return (
    <QuietHoursCard
      mailboxEmail={mailbox.email}
      mailboxStatus={mailbox.status}
      state={state}
      saving={update.isPending}
      onSave={onSave}
      onRetry={() => void query.refetch()}
    />
  );
}
