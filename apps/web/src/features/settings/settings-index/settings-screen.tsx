'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, ScreenIntro, tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type { ActionSheetPrefs, EmailPrefs } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import { AccountDeletionSection } from '@/features/account-deletion/account-deletion-section';
import { CookiePreferences } from '@/features/consent/cookie-preferences';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import {
  useMeSettings,
  useUpdateActionSheetPrefs,
  useUpdateEmailPrefs,
} from '../api/use-me-settings';
import { useBillingSubscription } from '../api/use-billing-subscription';
import { useMailboxesHealth } from '../api/use-mailbox-health';
import { ActionSheetPrefsCard, type ActionSheetPrefsCardState } from './action-sheet-prefs-card';
import { EmailPrefsCard, type EmailPrefsCardState } from './email-prefs-card';
import { MailboxesCard } from './mailboxes-card';

const { color, font } = tokens;

/**
 * Settings index (U23 — D34 / D114 / D116 / D216).
 *
 * D114's left-nav (Linear/Notion-style) over a sectioned single page.
 * The nav is a sticky anchor rail (hidden under 900px — the sections
 * scroll fine on their own); sections map to D114's nine groups,
 * scoped to what exists at launch:
 *
 *   1. Mailboxes      — D114 "Inboxes": health + reconnect (D115)
 *   2. Actions        — D34 skip-sheet toggles (D114 "Triage & Brief",
 *                       scoped: no Brief email exists yet)
 *   3. Notifications  — D165 per-category email toggles
 *   4. Autopilot      — link to /autopilot (rules live there)
 *   5. Quiet hours    — link to /quiet (D114 "Quiet schedules")
 *   6. Senders        — link to /settings/senders (D114 "Sender lists")
 *   7. Privacy & Data — link to /settings/privacy (D116/D217)
 *   8. Help            — compact D245 product glossary
 *   9. Cookies         — D147 consent change/withdrawal card
 *  10. Plan & Billing  — current plan summary + /billing link
 *  11. Account         — signed-in row + #218's deletion section (last)
 *
 * Deep link: `?cancelDeletion=1` (from the D216 "deletion scheduled"
 * email) scrolls to + highlights the Account section so the cancel
 * affordance is in view.
 */

/** Left-nav anchor targets — ids stamped on each SectionLabel. */
const NAV_SECTIONS = [
  { id: 'mailboxes', label: 'Mailboxes' },
  { id: 'actions', label: 'Actions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'quiet-hours', label: 'Quiet hours' },
  { id: 'senders', label: 'Senders' },
  { id: 'privacy', label: 'Privacy & data' },
  { id: 'help', label: 'Help & glossary' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'billing', label: 'Plan & billing' },
  { id: 'account', label: 'Account' },
] as const;

export function SettingsScreen() {
  const { me } = useAuth();
  const settings = useMeSettings();
  const updateSheetPrefs = useUpdateActionSheetPrefs('settings');
  const updateEmailPrefs = useUpdateEmailPrefs();
  const billing = useBillingSubscription();
  const healthById = useMailboxesHealth(me.mailboxes);
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

  useEffect(() => {
    void track('page_viewed', { page: 'settings', mailbox_id: null });
  }, []);

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

  const tier = billing.data?.tier ?? null;
  const manifestTier = tier && tier in TIER_MANIFEST ? TIER_MANIFEST[tier] : null;

  function connectAnother() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    window.location.assign(`${apiBase}/api/auth/google/connect-mailbox/start`);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 28,
        maxWidth: 980,
        margin: '0 auto',
        padding: '20px 24px 28px',
        fontFamily: font.sans,
      }}
    >
      {/* D114 left-nav — sticky anchor rail; hidden under 900px. */}
      <nav
        aria-label="Settings sections"
        className="dm-settings-nav"
        style={{
          position: 'sticky',
          top: 20,
          width: 160,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          paddingTop: 6,
        }}
      >
        {NAV_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            style={{
              fontSize: 12.5,
              color: color.fgSoft,
              textDecoration: 'none',
              padding: '5px 10px',
              borderRadius: 6,
            }}
          >
            {s.label}
          </a>
        ))}
      </nav>
      <style>{`@media (max-width: 899px) { .dm-settings-nav { display: none !important; } }`}</style>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 760,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <ScreenIntro
          id="settings"
          title="Settings"
          body={
            <>
              Your account-wide preferences — mailboxes, action behavior, email notifications,
              privacy, and plan. Per-sender rules live under{' '}
              <Link href="/settings/senders" style={{ color: color.primary }}>
                standing policies
              </Link>
              .
            </>
          }
        />

        <SectionLabel id="mailboxes">Mailboxes</SectionLabel>
        <MailboxesCard
          mailboxes={me.mailboxes}
          activeMailboxId={me.activeMailboxId}
          inboxLimit={manifestTier?.inboxLimit ?? null}
          healthById={healthById}
          onConnect={connectAnother}
        />

        <SectionLabel id="actions">Actions</SectionLabel>
        <ActionSheetPrefsCard
          state={sheetPrefsState}
          pendingWire={pendingWire}
          saveFailed={updateSheetPrefs.isError}
          onToggle={(wire, next) => {
            setPendingWire(wire);
            updateSheetPrefs.mutate({ [wire]: next }, { onSettled: () => setPendingWire(null) });
          }}
        />

        <SectionLabel id="notifications">Notifications</SectionLabel>
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
        />

        <SectionLabel id="autopilot">Autopilot</SectionLabel>
        <LinkCard
          title="Autopilot rules"
          description="Preset rules that keep known noise moving on their own — review, pause, or resume them from the Autopilot screen."
          href="/autopilot"
          cta="Open Autopilot"
        />

        <SectionLabel id="quiet-hours">Quiet hours</SectionLabel>
        <LinkCard
          title="Quiet hours"
          description="Scheduled windows where non-urgent mail waits outside your inbox until the window ends."
          href="/quiet"
          cta="Open Quiet hours"
        />

        <SectionLabel id="senders">Senders</SectionLabel>
        <LinkCard
          title="Standing policies"
          description="VIP and Protected sender lists — review or remove standing rules, jump to any sender's detail page."
          href="/settings/senders"
          cta="Open sender policies"
        />

        <SectionLabel id="privacy">Privacy &amp; data</SectionLabel>
        <LinkCard
          title="Privacy &amp; Data"
          description="Exactly what DeclutrMail stores (and never stores), your data export, and retention details."
          href="/settings/privacy"
          cta="Open Privacy & Data"
        />

        <SectionLabel id="help">Help &amp; glossary</SectionLabel>
        <LinkCard
          title="Product glossary"
          description="Plain-language definitions for sender controls, Autopilot modes, Later, Activity Undo, and Gmail Trash recovery."
          href="/settings/help"
          cta="Open product glossary"
        />

        <SectionLabel id="cookies">Cookies</SectionLabel>
        <CookiePreferences />

        <SectionLabel id="billing">Plan &amp; billing</SectionLabel>
        <PlanCard
          state={
            billing.isPending
              ? { kind: 'loading' }
              : billing.isError
                ? {
                    kind: 'unavailable',
                    reason:
                      billing.error instanceof ApiError && billing.error.status === 503
                        ? 'Billing is not enabled in this environment yet.'
                        : 'Could not load your plan right now.',
                  }
                : {
                    kind: 'ready',
                    planName: manifestTier?.name ?? billing.data.tier,
                    foundingMember: billing.data.foundingMember,
                  }
          }
        />

        <SectionLabel id="account-label">Account</SectionLabel>
        <div
          ref={accountRef}
          id="account"
          data-testid="settings-account-section"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            scrollMarginTop: 24,
            borderRadius: 14,
            outline: highlightAccount ? `2px solid ${color.danger}` : 'none',
            outlineOffset: 4,
            transition: 'outline-color 300ms',
          }}
        >
          <Card padding={0}>
            <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
                Signed in as
              </h3>
              <p style={{ ...mutedTextStyle, fontFamily: font.mono, fontSize: 12.5 }}>
                {me.user.email}
              </p>
            </div>
          </Card>
          <AccountDeletionSection />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      style={{
        fontFamily: font.mono,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: color.fgMuted,
        margin: '8px 0 -8px',
        scrollMarginTop: 24,
      }}
    >
      {children}
    </div>
  );
}

type PlanCardState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; planName: string; foundingMember: boolean };

/** Plan & Billing summary — link-only; the /billing screen owns the rest. */
function PlanCard({ state }: { state: PlanCardState }) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          Plan &amp; Billing
        </h3>
        {state.kind === 'loading' ? (
          <p role="status" style={mutedTextStyle}>
            Loading plan…
          </p>
        ) : state.kind === 'unavailable' ? (
          <p style={mutedTextStyle}>{state.reason}</p>
        ) : (
          <p style={mutedTextStyle}>
            Current plan:{' '}
            <strong style={{ color: color.fg, fontWeight: 600 }}>{state.planName}</strong>
            {state.foundingMember ? ' · Founding member' : ''}
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <Link href="/billing" style={{ textDecoration: 'none' }}>
            <Button tone="default">Manage plan &amp; billing →</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

function LinkCard({
  title,
  description,
  href,
  cta,
}: {
  title: React.ReactNode;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>{title}</h3>
        <p style={mutedTextStyle}>{description}</p>
        <div style={{ marginTop: 12 }}>
          <Link href={href} style={{ textDecoration: 'none' }}>
            <Button tone="default">{cta}</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

const mutedTextStyle = {
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: '8px 0 0',
} as const;
