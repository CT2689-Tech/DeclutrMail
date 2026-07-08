'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, ScreenIntro, tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type { ActionSheetPrefs } from '@declutrmail/shared/contracts';

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
import { ActionSheetPrefsCard, type ActionSheetPrefsCardState } from './action-sheet-prefs-card';
import { MailboxesCard } from './mailboxes-card';

const { color, font } = tokens;

/**
 * Settings index (U23 — D34 / D114 / D116 / D216).
 *
 * Sectioned single-page layout (D114's nine-section structure, scoped
 * to what exists at launch):
 *
 *   1. Mailboxes        — connected accounts + connect-another (D115)
 *   2. Action prefs     — D34 skip-sheet toggles (preview never skips)
 *   3. Email prefs      — D165 reminder toggle
 *   4. Sender lists     — link to /settings/senders (VIP + Protected)
 *   5. Privacy & Data   — link to /settings/privacy (D116/D217)
 *   6. Cookies          — D147 consent change/withdrawal card
 *   7. Plan & Billing   — current plan summary + /billing link
 *   8. Account          — #218's deletion section (danger zone, last)
 *
 * Deep link: `?cancelDeletion=1` (from the D216 "deletion scheduled"
 * email) scrolls to + highlights the Account section so the cancel
 * affordance is in view.
 */
export function SettingsScreen() {
  const { me } = useAuth();
  const settings = useMeSettings();
  const updateSheetPrefs = useUpdateActionSheetPrefs('settings');
  const updateEmailPrefs = useUpdateEmailPrefs();
  const billing = useBillingSubscription();
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

  const tier = billing.data?.tier ?? null;
  const manifestTier = tier && tier in TIER_MANIFEST ? TIER_MANIFEST[tier] : null;

  function connectAnother() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    window.location.assign(`${apiBase}/api/auth/google/connect-mailbox/start`);
  }

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 760,
        margin: '0 auto',
        fontFamily: font.sans,
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

      <SectionLabel>Mailboxes</SectionLabel>
      <MailboxesCard
        mailboxes={me.mailboxes}
        activeMailboxId={me.activeMailboxId}
        inboxLimit={manifestTier?.inboxLimit ?? null}
        onConnect={connectAnother}
      />

      <SectionLabel>Actions</SectionLabel>
      <ActionSheetPrefsCard
        state={sheetPrefsState}
        pendingWire={pendingWire}
        saveFailed={updateSheetPrefs.isError}
        onToggle={(wire, next) => {
          setPendingWire(wire);
          updateSheetPrefs.mutate({ [wire]: next }, { onSettled: () => setPendingWire(null) });
        }}
      />

      <SectionLabel>Email</SectionLabel>
      <EmailPrefsCard
        loading={settings.isPending}
        loadFailed={settings.isError}
        onRetry={() => void settings.refetch()}
        reminders={settings.data?.emailPrefs.reminders ?? null}
        pending={updateEmailPrefs.isPending}
        saveFailed={updateEmailPrefs.isError}
        onToggle={(next) => updateEmailPrefs.mutate({ reminders: next })}
      />

      <SectionLabel>Senders</SectionLabel>
      <LinkCard
        title="Standing policies"
        description="VIP and Protected sender lists — review or remove standing rules, jump to any sender's detail page."
        href="/settings/senders"
        cta="Open sender policies"
      />

      <SectionLabel>Privacy &amp; data</SectionLabel>
      <LinkCard
        title="Privacy &amp; Data"
        description="Exactly what DeclutrMail stores (and never stores), your data export, and retention details."
        href="/settings/privacy"
        cta="Open Privacy & Data"
      />

      <SectionLabel>Cookies</SectionLabel>
      <CookiePreferences />

      <SectionLabel>Plan &amp; billing</SectionLabel>
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

      <SectionLabel>Account</SectionLabel>
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
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: color.fgMuted,
        margin: '8px 0 -8px',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Email preferences (D165) — only REMINDER emails are toggleable;
 * system emails (sync-complete, deletion notices) are non-opt-out per
 * the CAN-SPAM/GDPR transactional carve-out, so no toggle exists for
 * them and the copy says so.
 */
function EmailPrefsCard({
  loading,
  loadFailed,
  onRetry,
  reminders,
  pending,
  saveFailed,
  onToggle,
}: {
  loading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  reminders: boolean | null;
  pending: boolean;
  saveFailed: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          Email notifications
        </h3>
        {loading ? (
          <p role="status" style={mutedTextStyle}>
            Loading email preferences…
          </p>
        ) : loadFailed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 13, color: color.danger }}>
              Could not load email preferences.
            </span>
            <Button tone="default" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: color.fg }}>
                  Reminder emails
                </div>
                <div style={{ fontSize: 12, color: color.fgMuted, marginTop: 2 }}>
                  The "your inbox is ready" nudge and similar re-engagement reminders.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={reminders === true}
                aria-label={`${reminders ? 'Disable' : 'Enable'} reminder emails`}
                onClick={() => onToggle(!(reminders === true))}
                disabled={pending}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: pending ? 'default' : 'pointer',
                  fontFamily: font.sans,
                }}
              >
                <span
                  style={{ fontSize: 11, color: color.fgMuted, minWidth: 34, textAlign: 'right' }}
                >
                  {pending ? 'Saving…' : reminders ? 'On' : 'Off'}
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 32,
                    height: 18,
                    borderRadius: 999,
                    background: reminders ? color.primary : color.mutedBg,
                    border: `1px solid ${reminders ? color.primary : color.border}`,
                    position: 'relative',
                    transition: 'background 120ms',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 1,
                      left: reminders ? 15 : 1,
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: '#FFFFFF',
                      boxShadow: '0 1px 2px rgba(14,20,19,0.25)',
                      transition: 'left 120ms',
                    }}
                  />
                </span>
              </button>
            </div>
            {saveFailed && (
              <p role="alert" style={{ fontSize: 12, color: color.danger, margin: '8px 0 0' }}>
                Could not save the preference. Try again.
              </p>
            )}
            <p style={{ ...mutedTextStyle, fontSize: 12 }}>
              System emails (sync complete, account-deletion notices) always send — they confirm
              actions you took.
            </p>
          </>
        )}
      </div>
    </Card>
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
