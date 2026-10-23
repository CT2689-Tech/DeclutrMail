'use client';

import {
  editorialColumnStyle,
  EditorialDescription,
  EditorialContents,
} from '@/features/editorial/page';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, ScreenIntro, toast, tokens } from '@declutrmail/shared';
import { SETTINGS_PREVIEWS_TITLE } from '@declutrmail/shared/copy/screen-decisions';
import { hasCapability } from '@declutrmail/shared/entitlements';
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
  CONNECT_START_RESULT_COPY,
  connectStartResultOf,
  type OAuthResultCopy,
  RECONNECT_RESULT_COPY,
  reconnectResultOf,
} from '@/features/mailboxes/oauth-result';
import {
  onboardingGateVerdict,
  useOnboardingState,
} from '@/features/onboarding/api/use-onboarding';
import {
  isBillingDisabledError,
  useBillingSubscription,
} from '@/features/billing/api/use-billing-subscription';
import { currentPlanTitle, deriveBillingViewState } from '@/features/billing/billing-model';
import { reportPassSecondAccountGate } from '@/lib/entitlements/upgrade-gate';
import { track } from '@/lib/posthog';
import { replaceUrl } from '@/lib/replace-url';
import {
  useMeSettings,
  useUpdateActionSheetPrefs,
  useUpdateBriefPrefs,
  useUpdateEmailPrefs,
} from '../api/use-me-settings';
import { useMailboxesHealth, type MailboxHealth } from '../api/use-mailbox-health';
import { DrillRow, PageHeader, SettingsGroup, SettingsRow } from '../settings-list';
import { VerbTourDialog } from '@/features/tour/verb-tour';
import { ActionSheetPrefsCard, type ActionSheetPrefsCardState } from './action-sheet-prefs-card';
import { BriefPrefsCard, type BriefPrefsCardState } from './brief-prefs-card';
import { EmailPrefsCard, type EmailPrefsCardState } from './email-prefs-card';
import { MailboxesCard } from './mailboxes-card';
import { SettingsRouteFallback } from './settings-route-fallback';
import { VerbTourCard } from './verb-tour-card';
import { AiSettingsSection } from '@/features/ai-consent/ai-settings-section';
import styles from './settings-screen.module.css';

const { color, font, text, radius, motion } = tokens;

const SECTION_IDS = new Set(['mailboxes', 'actions', 'notifications', 'ai', 'more', 'account']);

const MAILBOX_HASH = /^#mailbox-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

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
 *   4. AI             — consent controls when available     #ai
 *   5. Privacy & data — protected senders, privacy, help     #more
 *   6. Account        — signed-in row + deletion last        #account
 *
 * The quiet plan rail uses the existing billing read and stays independent
 * of preference errors. The header always links to Plan & billing.
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
  // Sync can finish in the shell before Settings hydrates. Keep the first
  // client health rows identical to SSR; cached health follows after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const healthById = Object.fromEntries(
    me.mailboxes.map((mailbox) => [
      mailbox.id,
      (mounted ? queriedHealthById[mailbox.id] : undefined) ?? initialMailboxHealth[mailbox.id],
    ]),
  );
  // ?cancelDeletion=1 — scroll + highlight the Account section (D216).
  // Waits for the layout-shifting queries (settings + billing cards
  // above the section) to settle first — scrolling at mount lands on a
  // shorter page, then the resolved cards push the section back below
  // the fold (caught in the U23 browser smoke). Scrolls exactly once.
  // Read from `window.location` inside the effect. `useSearchParams`
  // bails this screen into the route Suspense hole, so some loads SSR
  // the loading shell and the client hydrates the screen (React #418).
  const accountRef = useRef<HTMLDivElement>(null);
  const didDeepLinkScroll = useRef(false);
  // Prefetched settings and billing can sit in the client cache before this
  // screen's first paint, while the server HTML is still the loading
  // cards. Reading those caches swaps in the AI link, preview choices,
  // and plan name and fails hydration. The shell stays up until after mount.
  const settingsView = mounted ? settings : null;
  const billingView = mounted ? billing : null;
  const layoutSettled = mounted && !settings.isPending && !billing.isPending;
  const [highlightAccount, setHighlightAccount] = useState(false);
  const didInitialHashScroll = useRef(false);
  useEffect(() => {
    if (!layoutSettled || didDeepLinkScroll.current) return;
    if (new URLSearchParams(window.location.search).get('cancelDeletion') !== '1') return;
    didDeepLinkScroll.current = true;
    accountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlightAccount(true);
    const t = setTimeout(() => setHighlightAccount(false), 2600);
    return () => clearTimeout(t);
  }, [layoutSettled]);

  // OAuth reconnect/cold-start return. Query values are closed enums and
  // a reconnect target is accepted only from an exact UUID fragment.
  // Resolve rows with getElementById (never a selector built from URL
  // input), then scrub transient context so refresh cannot replay the
  // toast or retain a mailbox id in browser history.
  const didHandleReconnectResult = useRef(false);
  const [highlightMailboxId, setHighlightMailboxId] = useState<string | null>(null);
  const [reconnectAnnouncement, setReconnectAnnouncement] = useState<OAuthResultCopy | null>(null);
  // Someone who has not finished onboarding reaches this screen only to be
  // sent to /onboarding, and the gate carries the result there to show
  // (D108). Using it up here first would lose it. A failed read counts as
  // done, so the result still shows here.
  const onboarded = onboardingGateVerdict(useOnboardingState()) === 'open';
  useEffect(() => {
    // The first paint is the route fallback, which has no mailbox rows.
    // Consuming the result before those rows mount scrolls nowhere and
    // then refuses to run again.
    if (!mounted || didHandleReconnectResult.current || !onboarded) return;
    const params = new URLSearchParams(window.location.search);
    const reconnectResultParam = params.get('reconnect_result');
    const connectStartResultParam = params.get('connect_start_result');
    if (reconnectResultParam === null && connectStartResultParam === null) return;
    didHandleReconnectResult.current = true;

    const reconnectResult = reconnectResultOf(reconnectResultParam);
    const connectStartResult = connectStartResultOf(connectStartResultParam);
    if (connectStartResult === 'pass_second_account') {
      reportPassSecondAccountGate({ limit: 1, connected: 1, reason: 'pass' });
    } else {
      const copy = reconnectResult
        ? RECONNECT_RESULT_COPY[reconnectResult]
        : connectStartResult
          ? CONNECT_START_RESULT_COPY[connectStartResult]
          : null;
      if (copy) {
        setReconnectAnnouncement(copy);
        toast(copy.message, copy.tone);
      }
    }

    const mailboxId = reconnectResult ? reconnectMailboxIdFromHash(window.location.hash) : null;
    const mailboxRow = mailboxId ? document.getElementById(`mailbox-${mailboxId}`) : null;
    const scrollTarget = mailboxRow ?? document.getElementById('mailboxes');

    if (mailboxRow && mailboxId) setHighlightMailboxId(mailboxId);
    scrollTarget?.focus({ preventScroll: true });
    scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    replaceUrl((url) => {
      url.searchParams.delete('reconnect_result');
      url.searchParams.delete('connect_start_result');
      url.hash = 'mailboxes';
    });
  }, [mounted, onboarded]);

  // Highlight lifetime stays independent of the URL scrub.
  useEffect(() => {
    if (!highlightMailboxId) return;
    const timeout = window.setTimeout(() => setHighlightMailboxId(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [highlightMailboxId]);

  // The streamed fallback has no sections. Resolve ordinary deep links only
  // after the real groups settle, so a late preference/plan read cannot move
  // the target out of view. Native anchors retain their URL and keyboard use.
  useEffect(() => {
    if (!layoutSettled) return;
    const focusHashTarget = (event?: HashChangeEvent) => {
      // Ignore stale queued events and the OAuth effect's own URL scrub.
      if (event?.newURL && event.newURL !== window.location.href) return;
      if (event?.oldURL) {
        const previous = new URL(event.oldURL);
        if (
          previous.searchParams.has('reconnect_result') ||
          previous.searchParams.has('connect_start_result')
        )
          return;
      }
      const hash = window.location.hash;
      const id = hash.slice(1);
      if (!SECTION_IDS.has(id) && !reconnectMailboxIdFromHash(hash)) return;
      const target = document.getElementById(id);
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    };
    if (!didInitialHashScroll.current) {
      didInitialHashScroll.current = true;
      // These return flows own their focus, highlights and URL cleanup.
      const params = new URLSearchParams(window.location.search);
      if (
        !didHandleReconnectResult.current &&
        !params.has('reconnect_result') &&
        !params.has('connect_start_result') &&
        params.get('cancelDeletion') !== '1'
      ) {
        focusHashTarget();
      }
    }
    window.addEventListener('hashchange', focusHashTarget);
    return () => window.removeEventListener('hashchange', focusHashTarget);
  }, [layoutSettled]);

  useEffect(() => {
    void track('page_viewed', { page: 'settings', mailbox_id: null });
  }, []);

  // D38 replay — the tour has no onboarding step to return to once
  // onboarding is done, so Settings re-opens it in place.
  const [tourOpen, setTourOpen] = useState(false);

  const [pendingWire, setPendingWire] = useState<keyof ActionSheetPrefs | null>(null);
  const sheetPrefsState: ActionSheetPrefsCardState =
    settingsView == null || settingsView.isPending
      ? { kind: 'loading' }
      : settingsView.isError
        ? { kind: 'error', onRetry: () => void settings.refetch() }
        : { kind: 'ready', prefs: settingsView.data.actionSheetPrefs };

  const [pendingEmailWire, setPendingEmailWire] = useState<keyof EmailPrefs | null>(null);
  const emailPrefsState: EmailPrefsCardState =
    settingsView == null || settingsView.isPending
      ? { kind: 'loading' }
      : settingsView.isError
        ? { kind: 'error', onRetry: () => void settings.refetch() }
        : { kind: 'ready', prefs: settingsView.data.emailPrefs };

  const briefPrefsState: BriefPrefsCardState =
    settingsView == null || settingsView.isPending
      ? { kind: 'loading' }
      : settingsView.isError
        ? { kind: 'error', onRetry: () => void settings.refetch() }
        : // The read is typed, not runtime-validated, so an API that
          // predates this key returns a payload TypeScript still accepts.
          // Falling back to the server's own default keeps Settings —
          // including account deletion and data export — reachable;
          // reading `.hour` off an absent slice would throw and take the
          // whole screen with it (the 2026-07-09 whole-screen class).
          { kind: 'ready', prefs: settingsView.data.briefPrefs ?? DEFAULT_BRIEF_PREFS };

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
  const {
    tier: entitledTier,
    inboxLimit,
    inboxLimitReason,
    connectedInboxes,
    atInboxLimit,
  } = useTier();
  const briefUnlocked = hasCapability(entitledTier, 'brief');
  // A Backlog Pass can grant a Plus entitlement without being a Plus
  // subscription. Reuse Billing's plan projection so both pages name the
  // same access, including a paid subscription overlapping a Pass.
  const planView = deriveBillingViewState({
    isLoading: billingView == null || billingView.isPending,
    isError: billingView?.isError ?? false,
    error: billingView?.error,
    data: billingView?.data,
    meTier: entitledTier,
    pending: null,
  });
  const planName = planView.kind === 'plan' ? currentPlanTitle(planView) : null;

  function connectMailbox(reconnectMailboxId?: string) {
    if (inboxLimitReason === 'pass' && atInboxLimit && !reconnectMailboxId) {
      reportPassSecondAccountGate({
        limit: inboxLimit,
        connected: connectedInboxes,
        reason: 'pass',
      });
      return;
    }
    startMailboxConnect(reconnectMailboxId);
  }

  function reactivateMailbox(mailboxId: string) {
    startMailboxReactivation(mailboxId);
  }

  // Same tree as `settings/loading.tsx`. Hydration sometimes paints this
  // screen into that fallback DOM; a richer first paint throws #418.
  if (!mounted) return <SettingsRouteFallback />;

  return (
    <div
      className={`dm-settings-page ${styles.page}`}
      style={{
        ...editorialColumnStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        maxWidth: 1120,
      }}
    >
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
      <div className={styles.header}>
        <PageHeader title="Settings">
          <Link className={styles.billingLink} href="/billing">
            Plan &amp; billing
          </Link>
        </PageHeader>
        <EditorialDescription>
          Gmail accounts, cleanup previews and email preferences.
        </EditorialDescription>
      </div>
      <ScreenIntro
        id="settings"
        title="Settings"
        body="Gmail accounts, previews, emails, privacy and your plan."
      />

      <div className={styles.layout}>
        <div className={styles.preferences}>
          <EditorialContents
            items={[
              { href: '#mailboxes', label: 'Gmail accounts' },
              { href: '#actions', label: SETTINGS_PREVIEWS_TITLE },
              { href: '#notifications', label: 'Email notifications' },
              ...(settingsView?.data?.aiConsent ? [{ href: '#ai', label: 'AI' }] : []),
              { href: '#more', label: 'Privacy and data' },
              { href: '#account', label: 'Your account' },
            ]}
          />
          <MailboxesCard
            mailboxes={me.mailboxes}
            activeMailboxId={me.activeMailboxId}
            inboxLimit={inboxLimit}
            {...(inboxLimitReason === 'pass' ? { inboxLimitReason: 'pass' as const } : {})}
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
              updateEmailPrefs.mutate(
                { [wire]: next },
                { onSettled: () => setPendingEmailWire(null) },
              );
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

          {settingsView?.data?.aiConsent && (
            <AiSettingsSection view={settingsView.data.aiConsent} briefCapable={briefUnlocked} />
          )}

          <SettingsGroup id="more" title="Privacy and data">
            <DrillRow href="/settings/senders" label="Protected senders" />
            <DrillRow href="/settings/privacy" label="Privacy & data" />
            <DrillRow href="/settings/help" label="Help & glossary" />
          </SettingsGroup>
        </div>
        <PlanSummary
          state={
            billingView == null || billingView.isPending
              ? { kind: 'loading' }
              : billingView.isError
                ? isBillingDisabledError(billingView.error)
                  ? { kind: 'disabled' }
                  : { kind: 'error', onRetry: () => void billing.refetch() }
                : planName === null
                  ? { kind: 'error', onRetry: () => void billing.refetch() }
                  : {
                      kind: 'ready',
                      planName,
                      foundingMember: billingView.data.foundingMember,
                    }
          }
        />

        <div
          ref={accountRef}
          id="account"
          tabIndex={-1}
          className={styles.account}
          data-testid="settings-account-section"
          style={{
            scrollMarginTop: 24,
            borderRadius: radius.xl,
            outline: highlightAccount ? `2px solid ${color.danger}` : undefined,
            outlineOffset: 6,
            transition: `outline-color ${motion.base} ${motion.ease}`,
          }}
        >
          <SettingsGroup title="Your account">
            <SettingsRow label="Signed in as">
              <span style={{ fontFamily: font.sans, fontSize: text.md, color: color.fgMuted }}>
                {me.user.email}
              </span>
            </SettingsRow>
            <AccountDeletionSection />
          </SettingsGroup>
        </div>
      </div>
    </div>
  );
}

type PlanSummaryState =
  | { kind: 'loading' }
  /** 503 BILLING_DISABLED — the flag is off. Deterministic, so no retry. */
  | { kind: 'disabled' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; planName: string; foundingMember: boolean };

/** A scoped readout; billing failure never replaces account controls. */
function PlanSummary({ state }: { state: PlanSummaryState }) {
  return (
    <aside className={styles.plan} aria-labelledby="settings-plan-title">
      <h2 id="settings-plan-title">Your plan</h2>
      {state.kind === 'loading' ? (
        <p role="status">Loading plan…</p>
      ) : state.kind === 'disabled' ? (
        <p>Not enabled</p>
      ) : state.kind === 'ready' ? (
        <>
          <strong className={styles.planName}>{state.planName}</strong>
          {state.foundingMember ? <p>Founding member</p> : null}
        </>
      ) : (
        <>
          <p role="alert">Could not load your plan.</p>
          <Button tone="default" onClick={state.onRetry} style={{ marginTop: 12, minHeight: 44 }}>
            Retry
          </Button>
        </>
      )}
      <p>Usage, payment details and invoices are in Plan &amp; billing.</p>
    </aside>
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
