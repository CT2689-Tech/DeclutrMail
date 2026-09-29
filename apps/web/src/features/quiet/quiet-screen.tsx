'use client';

import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
  EditorialDescription,
} from '@/features/editorial/page';

import { useEffect } from 'react';
import Link from 'next/link';

import { EmptyState, ScreenIntro, tokens } from '@declutrmail/shared';
import type { QuietHoursConfig } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { track } from '@/lib/posthog';
import { addBreadcrumb } from '@/lib/sentry';
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
 * Guard 2) — suggestions the user approved included, since approving
 * queues that same sweep; actions the user takes directly always run.
 * Out of scope at this unit (the
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
        Autopilot holds its actions during quiet hours. Gmail delivery continues.
      </EditorialDescription>
      <ScreenIntro
        id="quiet"
        title="Quiet hours"
        body="During quiet hours, Autopilot also holds suggestions you approve."
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

  // No data yet — the first fetch, or one waiting to go back online — is
  // loading. It used to fall through to an unconfigured form showing the
  // defaults, and saving that form would replace the stored window.
  const state: QuietHoursCardState = query.isError
    ? {
        kind: 'error',
        message: "We couldn't load quiet hours right now.",
      }
    : query.data
      ? {
          kind: 'ready',
          config: query.data.config,
          activeNow: query.data.activeNow,
        }
      : { kind: 'loading' };

  const onSave = (config: QuietHoursConfig) => {
    addBreadcrumb({
      category: 'action',
      message: 'quiet: hours saved',
      level: 'info',
    });
    update.mutate(config);
  };

  // "Saved" answers the latest save only: the next edit, or a retry
  // after a failed refresh, ends it.
  const endSaved = () => {
    if (update.isSuccess) update.reset();
  };

  // Quiet holds nothing while it is off. A failed refresh shows the error
  // card, which a count from the last good read would contradict. A
  // disconnected inbox runs nothing until it is reconnected, and its row
  // in the account menu is disabled.
  const heldCount =
    state.kind === 'ready' && state.activeNow && mailbox.status !== 'disconnected'
      ? (query.data?.heldCount ?? 0)
      : 0;

  return (
    // One raised settings group per mailbox, its address as the group title.
    <div style={{ display: 'grid', gap: 8 }}>
      {active && <p style={{ margin: 0, color: color.primary, fontSize: text.sm }}>Active inbox</p>}
      <QuietHoursCard
        mailboxEmail={mailbox.email}
        mailboxStatus={mailbox.status}
        state={state}
        saving={update.isPending}
        justSaved={update.isSuccess}
        onEdit={endSaved}
        onSave={onSave}
        onRetry={() => {
          endSaved();
          void query.refetch();
        }}
      />
      {heldCount > 0 && (
        <QuietQueueSummary
          mailboxEmail={mailbox.email}
          activeInbox={active}
          heldCount={heldCount}
        />
      )}
    </div>
  );
}

function QuietQueueSummary({
  mailboxEmail,
  activeInbox,
  heldCount,
}: {
  mailboxEmail: string;
  activeInbox: boolean;
  heldCount: number;
}) {
  // No end time: the End row states it, and a rule's daily cap can keep
  // some of these past it.
  return (
    <p
      role="status"
      aria-label={`Quiet status for ${mailboxEmail}`}
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
      {heldCount} {heldCount === 1 ? 'Autopilot action is' : 'Autopilot actions are'} held.{' '}
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
