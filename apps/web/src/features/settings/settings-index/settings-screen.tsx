'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScreenIntro, toast, tokens } from '@declutrmail/shared';
import type { ToastTone } from '@declutrmail/shared';
import { hasCapability, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { DEFAULT_BRIEF_PREFS } from '@declutrmail/shared/contracts';
import type { ActionSheetPrefs, EmailPrefs } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import { useTier } from '@/features/auth/api/use-tier';
import { AccountDeletionSection } from '@/features/account-deletion/account-deletion-section';
import {
  startMailboxConnect,
  startMailboxReactivation,
} from '@/features/mailboxes/connect-mailbox-url';
import {
  isBillingDisabledError,
  useBillingSubscription,
} from '@/features/billing/api/use-billing-subscription';
import { track } from '@/lib/posthog';
import {
  useMeSettings,
  useUpdateActionSheetPrefs,
  useUpdateBriefPrefs,
  useUpdateEmailPrefs,
} from '../api/use-me-settings';
import { useMailboxesHealth, type MailboxHealth } from '../api/use-mailbox-health';
import {
  DrillRow,
  PageHeader,
  SettingsGroup,
  SettingsRow,
  SettingsRowStatus,
} from '../settings-list';
import { VerbTourDialog } from '@/features/tour/verb-tour';
import { ActionSheetPrefsCard, type ActionSheetPrefsCardState } from './action-sheet-prefs-card';
import { BriefPrefsCard, type BriefPrefsCardState } from './brief-prefs-card';
import { EmailPrefsCard, type EmailPrefsCardState } from './email-prefs-card';
import { MailboxesCard } from './mailboxes-card';
import { VerbTourCard } from './verb-tour-card';

const { color, font, text, radius, motion } = tokens;

type ReconnectResult = 'success' | 'account_mismatch' | 'target_invalid' | 'cancelled' | 'failed';
type ConnectStartResult = 'target_invalid' | 'inbox_limit' | 'session_retry' | 'rate_limited';

/**
 * Closed, privacy-safe copy for the OAuth return contract. Never echo
 * provider errors, mailbox ids, or email addresses from the URL.
 */
type ReconnectResultCopy = {
  message: string;
  tone: ToastTone;
  liveRole: 'status' | 'alert';
};

const RECONNECT_RESULT_COPY: Record<ReconnectResult, ReconnectResultCopy> = {
  success: {
    message: 'Gmail reconnected. Sync status is shown below.',
    tone: 'success',
    liveRole: 'status',
  },
  account_mismatch: {
    message: 'That was a different Google account. Retry Reconnect next to the mailbox you meant.',
    tone: 'danger',
    liveRole: 'alert',
  },
  target_invalid: {
    message: 'Could not match that recovery request to the mailbox you chose. Try again below.',
    tone: 'danger',
    liveRole: 'alert',
  },
  cancelled: {
    message: 'Gmail reconnect was cancelled. Nothing changed.',
    tone: 'info',
    liveRole: 'status',
  },
  failed: {
    message: 'Could not reconnect Gmail. Try again from this mailbox list.',
    tone: 'danger',
    liveRole: 'alert',
  },
};

const CONNECT_START_RESULT_COPY: Record<ConnectStartResult, ReconnectResultCopy> = {
  target_invalid: {
    message: 'That Gmail recovery request is no longer available. Choose a mailbox and try again.',
    tone: 'danger',
    liveRole: 'alert',
  },
  inbox_limit: {
    message:
      'Your plan’s Gmail limit is in use. Review your plan or disconnect a mailbox, then try again.',
    tone: 'warn',
    liveRole: 'status',
  },
  session_retry: {
    message: 'We couldn’t verify your session for that Gmail connection. Try again.',
    tone: 'warn',
    liveRole: 'status',
  },
  rate_limited: {
    message: 'Too many Gmail connection attempts. Wait a moment, then try again.',
    tone: 'warn',
    liveRole: 'status',
  },
};

const MAILBOX_HASH = /^#mailbox-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function reconnectResultOf(value: string | null): ReconnectResult | null {
  switch (value) {
    case 'success':
    case 'account_mismatch':
    case 'target_invalid':
    case 'cancelled':
    case 'failed':
      return value;
    default:
      return null;
  }
}

function connectStartResultOf(value: string | null): ConnectStartResult | null {
  switch (value) {
    case 'target_invalid':
    case 'inbox_limit':
    case 'session_retry':
    case 'rate_limited':
      return value;
    default:
      return null;
  }
}

function reconnectMailboxIdFromHash(hash: string): string | null {
  return MAILBOX_HASH.exec(hash)?.[1] ?? null;
}

/**
 * Settings index (U23 — D34 / D114 / D116 / D216).
 *
 * One column of grouped rows (label left, control / value / chevron
 * right). Groups, in order:
 *
 *   1. Gmail accounts — health + reconnect (D115)          #mailboxes
 *   2. Actions        — D34 preview placement + D38 tour    #actions
 *   3. Notifications  — D165 email toggles + D64 Brief hour #notifications
 *   4. More           — drill-ins with no sidebar entry: protected
 *                       senders, privacy & data (which also holds the
 *                       D147 cookie choice), help, plan & billing
 *   5. Account        — signed-in row + the D216 deletion rows #account
 *
 * The group ids are deep-link targets (OAuth returns, notification
 * emails, the no-active-mailbox gate) — renaming one breaks a link
 * that no test in this package can see.
 *
 * Deep link: `?cancelDeletion=1` (from the D216 "deletion scheduled"
 * email) scrolls to + highlights the Account group so the cancel
 * affordance is in view.
 */
export function SettingsScreen({
  initialMailboxHealth = {},
}: {
  initialMailboxHealth?: Record<string, MailboxHealth | undefined>;
} = {}) {
  const { me } = useAuth();
  const settings = useMeSettings();
  const updateSheetPrefs = useUpdateActionSheetPrefs('settings');
  const updateEmailPrefs = useUpdateEmailPrefs();
  const updateBriefPrefs = useUpdateBriefPrefs();
  const billing = useBillingSubscription();
  const queriedHealthById = useMailboxesHealth(me.mailboxes);
  const healthById = Object.fromEntries(
    me.mailboxes.map((mailbox) => [
      mailbox.id,
      queriedHealthById[mailbox.id] ?? initialMailboxHealth[mailbox.id],
    ]),
  );
  const searchParams = useSearchParams();

  // ?cancelDeletion=1 — scroll + highlight the Account section (D216).
  // Waits for the layout-shifting queries (settings + billing cards
  // above the section) to settle first — scrolling at mount lands on a
  // shorter page, then the resolved cards push the section back below
  // the fold (caught in the U23 browser smoke). Scrolls exactly once.
  const accountRef = useRef<HTMLDivElement>(null);
  const didDeepLinkScroll = useRef(false);
  const wantsCancelDeletion = searchParams.get('cancelDeletion') === '1';
  const layoutSettled = !settings.isPending && !billing.isPending;
  const [highlightAccount, setHighlightAccount] = useState(false);
  useEffect(() => {
    if (!wantsCancelDeletion || !layoutSettled || didDeepLinkScroll.current) return;
    didDeepLinkScroll.current = true;
    accountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlightAccount(true);
    const t = setTimeout(() => setHighlightAccount(false), 2600);
    return () => clearTimeout(t);
  }, [wantsCancelDeletion, layoutSettled]);

  // OAuth reconnect/cold-start return. Query values are closed enums and
  // a reconnect target is accepted only from an exact UUID fragment.
  // Resolve rows with getElementById (never a selector built from URL
  // input), then scrub transient context so refresh cannot replay the
  // toast or retain a mailbox id in browser history.
  const reconnectResultParam = searchParams.get('reconnect_result');
  const connectStartResultParam = searchParams.get('connect_start_result');
  const reconnectSearch = searchParams.toString();
  const didHandleReconnectResult = useRef(false);
  const [highlightMailboxId, setHighlightMailboxId] = useState<string | null>(null);
  const [reconnectAnnouncement, setReconnectAnnouncement] = useState<ReconnectResultCopy | null>(
    null,
  );
  useEffect(() => {
    if (
      (reconnectResultParam === null && connectStartResultParam === null) ||
      didHandleReconnectResult.current
    )
      return;
    didHandleReconnectResult.current = true;

    const reconnectResult = reconnectResultOf(reconnectResultParam);
    const connectStartResult = connectStartResultOf(connectStartResultParam);
    const copy = reconnectResult
      ? RECONNECT_RESULT_COPY[reconnectResult]
      : connectStartResult
        ? CONNECT_START_RESULT_COPY[connectStartResult]
        : null;
    if (copy) {
      setReconnectAnnouncement(copy);
      toast(copy.message, copy.tone);
    }

    const mailboxId = reconnectResult ? reconnectMailboxIdFromHash(window.location.hash) : null;
    const mailboxRow = mailboxId ? document.getElementById(`mailbox-${mailboxId}`) : null;
    const scrollTarget = mailboxRow ?? document.getElementById('mailboxes');

    if (mailboxRow && mailboxId) setHighlightMailboxId(mailboxId);
    scrollTarget?.focus({ preventScroll: true });
    scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const nextParams = new URLSearchParams(reconnectSearch);
    nextParams.delete('reconnect_result');
    nextParams.delete('connect_start_result');
    const nextSearch = nextParams.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}#mailboxes`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [connectStartResultParam, reconnectResultParam, reconnectSearch]);

  // Keep highlight lifetime independent from the URL effect: Next's
  // native-history integration updates useSearchParams after replaceState.
  useEffect(() => {
    if (!highlightMailboxId) return;
    const timeout = window.setTimeout(() => setHighlightMailboxId(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [highlightMailboxId]);

  useEffect(() => {
    void track('page_viewed', { page: 'settings', mailbox_id: null });
  }, []);

  // D38 replay — the tour has no onboarding step to return to once
  // onboarding is done, so Settings re-opens it in place.
  const [tourOpen, setTourOpen] = useState(false);

  const [pendingWire, setPendingWire] = useState<keyof ActionSheetPrefs | null>(null);
  const sheetPrefsState: ActionSheetPrefsCardState = settings.isPending
    ? { kind: 'loading' }
    : settings.isError
      ? { kind: 'error', onRetry: () => void settings.refetch() }
      : { kind: 'ready', prefs: settings.data.actionSheetPrefs };

  const [pendingEmailWire, setPendingEmailWire] = useState<keyof EmailPrefs | null>(null);
  const emailPrefsState: EmailPrefsCardState = settings.isPending
    ? { kind: 'loading' }
    : settings.isError
      ? { kind: 'error', onRetry: () => void settings.refetch() }
      : { kind: 'ready', prefs: settings.data.emailPrefs };

  const briefPrefsState: BriefPrefsCardState = settings.isPending
    ? { kind: 'loading' }
    : settings.isError
      ? { kind: 'error', onRetry: () => void settings.refetch() }
      : // The read is typed, not runtime-validated, so an API that
        // predates this key returns a payload TypeScript still accepts.
        // Falling back to the server's own default keeps Settings —
        // including account deletion and data export — reachable;
        // reading `.hour` off an absent slice would throw and take the
        // whole screen with it (the 2026-07-09 whole-screen class).
        { kind: 'ready', prefs: settings.data.briefPrefs ?? DEFAULT_BRIEF_PREFS };

  const tier = billing.data?.tier ?? null;
  const manifestTier = tier && tier in TIER_MANIFEST ? TIER_MANIFEST[tier] : null;
  // The card configures a Brief this workspace only receives on an
  // entitled tier. Under-tier settings would be a control with no
  // effect; /brief already carries the upgrade path, so nothing is
  // hidden from someone who wants the feature.
  //
  // Keyed on `useTier()` (i.e. `/api/auth/me`), NOT the billing read
  // above: `GET /api/billing/subscription` 503s BILLING_DISABLED while
  // billing is dark, which is the CURRENT production posture. Reading
  // the tier from there hid this card from every entitled workspace and
  // rendered clean in tests, whose fixture always answers that call 200.
  const { tier: entitledTier } = useTier();
  const briefUnlocked = hasCapability(entitledTier, 'brief');

  function connectMailbox(reconnectMailboxId?: string) {
    startMailboxConnect(reconnectMailboxId);
  }

  function reactivateMailbox(mailboxId: string) {
    startMailboxReactivation(mailboxId);
  }

  return (
    <div
      className="dm-settings-page"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
        fontFamily: font.sans,
      }}
    >
      <style>{`@media (max-width: 480px) { .dm-settings-page { padding-left: 16px !important; padding-right: 16px !important; } }`}</style>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="reconnect-result-status"
        style={screenReaderOnlyStyle}
      >
        {reconnectAnnouncement?.liveRole === 'status' ? reconnectAnnouncement.message : ''}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="reconnect-result-alert"
        style={screenReaderOnlyStyle}
      >
        {reconnectAnnouncement?.liveRole === 'alert' ? reconnectAnnouncement.message : ''}
      </div>
      <PageHeader title="Settings" />
      <ScreenIntro
        id="settings"
        title="Settings"
        body="Mailboxes, action previews, notifications, privacy and plan."
      />

      <MailboxesCard
        mailboxes={me.mailboxes}
        activeMailboxId={me.activeMailboxId}
        inboxLimit={manifestTier?.inboxLimit ?? null}
        healthById={healthById}
        highlightMailboxId={highlightMailboxId}
        onConnect={connectMailbox}
        onReactivate={reactivateMailbox}
      />

      <ActionSheetPrefsCard
        state={sheetPrefsState}
        pendingWire={pendingWire}
        saveFailed={updateSheetPrefs.isError}
        onToggle={(wire, next) => {
          setPendingWire(wire);
          updateSheetPrefs.mutate({ [wire]: next }, { onSettled: () => setPendingWire(null) });
        }}
      >
        <VerbTourCard onReplay={() => setTourOpen(true)} />
      </ActionSheetPrefsCard>
      {tourOpen && <VerbTourDialog onClose={() => setTourOpen(false)} />}

      <EmailPrefsCard
        state={emailPrefsState}
        pendingWire={pendingEmailWire}
        saveFailed={updateEmailPrefs.isError}
        onToggle={(wire, next) => {
          setPendingEmailWire(wire);
          updateEmailPrefs.mutate({ [wire]: next }, { onSettled: () => setPendingEmailWire(null) });
        }}
      >
        {/* The group's own row already reports a loading / failed read;
            the Brief row joins only once there is an hour to show. */}
        {briefUnlocked && briefPrefsState.kind === 'ready' && (
          <BriefPrefsCard
            state={briefPrefsState}
            timezone={me.user.timezone}
            pending={updateBriefPrefs.isPending}
            saveFailed={updateBriefPrefs.isError}
            onChange={(hour) => updateBriefPrefs.mutate({ hour })}
          />
        )}
      </EmailPrefsCard>

      {/* Autopilot and Quiet hours live in the sidebar; these are the
          destinations that have no other way in. */}
      <SettingsGroup id="more" title="More">
        <DrillRow href="/settings/senders" label="Protected senders" />
        <DrillRow href="/settings/privacy" label="Privacy & data" />
        <DrillRow href="/settings/help" label="Help & glossary" />
        <PlanRow
          state={
            billing.isPending
              ? { kind: 'loading' }
              : billing.isError
                ? // Only the BILLING_DISABLED envelope code means the flag is
                  // off. A bare 503 also covers BILLING_NOT_PROVISIONED and
                  // any upstream outage — those are failures, and retryable.
                  isBillingDisabledError(billing.error)
                  ? { kind: 'disabled' }
                  : { kind: 'error', onRetry: () => void billing.refetch() }
                : {
                    kind: 'ready',
                    planName: manifestTier?.name ?? billing.data.tier,
                    foundingMember: billing.data.foundingMember,
                  }
          }
        />
      </SettingsGroup>

      <div
        ref={accountRef}
        id="account"
        data-testid="settings-account-section"
        style={{
          scrollMarginTop: 24,
          borderRadius: radius.xl,
          outline: highlightAccount ? `2px solid ${color.danger}` : 'none',
          outlineOffset: 6,
          transition: `outline-color ${motion.base} ${motion.ease}`,
        }}
      >
        <SettingsGroup title="Account">
          <SettingsRow label="Signed in as">
            <span style={{ fontFamily: font.sans, fontSize: text.md, color: color.fgMuted }}>
              {me.user.email}
            </span>
          </SettingsRow>
          <AccountDeletionSection />
        </SettingsGroup>
      </div>
    </div>
  );
}

type PlanRowState =
  | { kind: 'loading' }
  /** 503 BILLING_DISABLED — the flag is off. Deterministic, so no retry. */
  | { kind: 'disabled' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; planName: string; foundingMember: boolean };

/**
 * Plan & billing drill-in — the only way to /billing once it leaves the
 * sidebar, so the link renders in EVERY state; a failed read adds a
 * retry row under it instead of replacing it.
 */
function PlanRow({ state }: { state: PlanRowState }) {
  return (
    <>
      <DrillRow
        href="/billing"
        label="Plan & billing"
        value={
          state.kind === 'loading' ? (
            <span role="status">Loading plan…</span>
          ) : state.kind === 'disabled' ? (
            'Not enabled'
          ) : state.kind === 'ready' ? (
            `${state.planName}${state.foundingMember ? ' · Founding member' : ''}`
          ) : null
        }
      />
      {state.kind === 'error' && (
        <SettingsRowStatus state={state} loadingLabel="" errorLabel="Could not load your plan." />
      )}
    </>
  );
}

const screenReaderOnlyStyle = {
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
