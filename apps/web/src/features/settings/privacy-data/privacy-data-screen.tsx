'use client';

import {
  editorialColumnStyle,
  EditorialKicker,
  EditorialContents,
  EditorialDescription,
} from '@/features/editorial/page';

import { useEffect, type ReactNode } from 'react';
import { Button, CASA_VERIFICATION_APPROVED_ON, ScreenIntro, tokens } from '@declutrmail/shared';
import { MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';
import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { CookiePreferences } from '@/features/consent/cookie-preferences';
import { track } from '@/lib/posthog';
import { useBillingSubscription } from '@/features/billing/api/use-billing-subscription';
import { dataExportFailure, useDataExport, type DataExportFailure } from '../api/use-data-export';
import { DrillRow, PageHeader, SettingsGroup, SettingsRow } from '../settings-list';
import type { PrivacyDataExportCopy } from './privacy-data-content';

const { color, font, text } = tokens;

/**
 * Settings → Privacy & Data (D116 + D217 + D228) — the dedicated
 * trust sub-page.
 *
 *   1. <PrivacyBadge variant="card"> — the D228 locked copy ("We never
 *      fetch or store full email contents." + the explicit storage
 *      list). Copy literals live ONLY in
 *      packages/shared/src/copy/privacy.ts.
 *   2. Indexed mailboxes — which accounts the storage list applies to.
 *   3. Undo retention — how long reversible actions stay reversible.
 *   4. Data export — mailbox metadata grouped as JSON plus per-dataset
 *      CSVs (message index / senders / decisions) via GET
 *      /api/account/export.
 *      D228-allowlisted columns only.
 *   4b. Cookie preferences — the D147 change/withdrawal surface.
 *   5. Leave cleanly — pointers to disconnect + account deletion.
 *   6. Legal & evidence — CASA Tier 2 row (static copy, link lands
 *      when the letter publishes) + policy notes.
 */
export function PrivacyDataRoute({
  privacyContent,
  exportCopy,
}: {
  privacyContent: ReactNode;
  exportCopy: PrivacyDataExportCopy;
}) {
  const { me } = useAuth();
  const billing = useBillingSubscription();
  const exporter = useDataExport();

  const tier = billing.data?.tier ?? null;
  const undoDays = tier && tier in TIER_MANIFEST ? TIER_MANIFEST[tier].undoWindowDays : null;

  return (
    <PrivacyDataView
      privacyContent={privacyContent}
      exportCopy={exportCopy}
      mailboxes={me.mailboxes}
      undoDays={undoDays}
      exportPendingFormat={exporter.isPending ? (exporter.variables ?? null) : null}
      exportFailed={exporter.isError}
      exportFailure={exporter.isError ? dataExportFailure(exporter.error) : null}
      exportPreparedFormat={exporter.isSuccess ? (exporter.variables ?? null) : null}
      onExport={(format) => exporter.mutate(format)}
    />
  );
}

/** Dumb view — storyable without auth/query shims. */
export function PrivacyDataView({
  privacyContent,
  exportCopy,
  mailboxes,
  undoDays,
  exportPendingFormat,
  exportFailed,
  exportFailure,
  exportPreparedFormat = null,
  onExport,
}: {
  privacyContent: ReactNode;
  exportCopy: PrivacyDataExportCopy;
  mailboxes: MeMailbox[];
  /** Tier-resolved undo window; null while the tier is unknown. */
  undoDays: number | null;
  exportPendingFormat: DataExportFormat | null;
  exportFailed: boolean;
  exportFailure?: DataExportFailure | null;
  /** Browser download handoff, not proof that the user saved the file. */
  exportPreparedFormat?: DataExportFormat | null;
  onExport: (format: DataExportFormat) => void;
}) {
  useEffect(() => {
    void track('page_viewed', { page: 'settings', mailbox_id: null });
  }, []);

  return (
    <div
      className="dm-settings-page"
      style={{
        ...editorialColumnStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
      }}
    >
      <style>{`@media (max-width: 480px) { .dm-settings-page { padding-left: 16px !important; padding-right: 16px !important; } }`}</style>
      <EditorialKicker>Your workspace / Privacy & data</EditorialKicker>
      <PageHeader title="Privacy & data" backToSettings />
      <EditorialDescription>
        Review access and stored data for all connected inboxes, export your records, or manage
        retention and deletion. Connection status is separate from sync health in Settings.
      </EditorialDescription>
      <EditorialContents
        items={[
          { href: '#privacy-connected-mailboxes', label: 'Connected inboxes' },
          { href: '#privacy-gmail-data-inventory', label: 'Data inventory' },
          { href: '#privacy-undo-retention', label: 'Recovery' },
          { href: '#privacy-export-my-data', label: 'Export' },
          { href: '#privacy-cookie-preferences', label: 'Cookies' },
          { href: '#privacy-leave-cleanly', label: 'Disconnect or delete' },
          { href: '#privacy-legal-evidence', label: 'Policies' },
        ]}
      />
      <ScreenIntro
        id="settings-privacy"
        title="Privacy & data"
        body="What DeclutrMail fetches, saves, shares and deletes — Google grants broader access than it uses."
      />

      {privacyContent}

      {/* 2 — which mailboxes the storage list applies to. */}
      <Section title="Connected mailboxes">
        {mailboxes.length === 0 ? (
          <p className="dm-settings-row" style={{ ...bodyTextStyle, ...blockRowStyle }}>
            No mailboxes connected — no Gmail data is being saved right now.
          </p>
        ) : (
          mailboxes.map((m) => (
            <SettingsRow
              key={m.id}
              label={
                <span style={{ fontFamily: font.sans, overflowWrap: 'anywhere' }}>{m.email}</span>
              }
            >
              <span style={{ fontSize: text.sm, color: color.fgMuted }}>
                {m.status === 'disconnected' ? 'disconnected — sync stopped' : 'data saved'}
              </span>
            </SettingsRow>
          ))
        )}
      </Section>

      {/* 3 — undo retention. */}
      <Section title="Undo retention">
        <p className="dm-settings-row" style={{ ...bodyTextStyle, ...blockRowStyle }}>
          {undoDays !== null ? (
            <>
              Archive, Later, and archived unsubscribe email can be undone from Activity for{' '}
              <strong style={{ color: color.fg }}>{undoDays} days</strong> on your plan.
            </>
          ) : (
            <>
              Archive, Later, and archived unsubscribe email can be undone from Activity for at
              least {MIN_UNDO_WINDOW_DAYS} days on any plan.
            </>
          )}{' '}
          {UNIFORM_UNDO_WINDOW_DAYS === null
            ? "Delete also uses your plan's Activity Undo window."
            : `Delete also uses the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity Undo window.`}{' '}
          Gmail Trash recovery is separate and lasts up to 30 days; a delivered unsubscribe request
          cannot be recalled. Account deletion waits for open undo windows unless you waive them.
        </p>
      </Section>

      {/* 4 — data export (D116 + DPDP). */}
      <Section title="Export my data">
        <div className="dm-settings-row" style={blockRowStyle}>
          {/* QA-sender-detail-20260902-02: the JSON export genuinely
              includes the Gmail preview snippet on every message, so this
              paragraph must never claim exports contain no email text. */}
          <p style={bodyTextStyle}>
            {exportCopy.limitation} Current JSON includes {exportCopy.jsonDescription} The CSVs each
            cover the dataset named on the button. App preferences and billing records are not
            included.
          </p>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXPORT_FORMATS.map((format) => (
              <Button
                key={format}
                tone="default"
                style={{ minHeight: 44 }}
                disabled={exportPendingFormat !== null}
                onClick={() => onExport(format)}
              >
                {exportPendingFormat === format
                  ? exportCopy.formats[format].pendingLabel
                  : exportCopy.formats[format].buttonLabel}
              </Button>
            ))}
          </div>
          {exportFailed && exportPendingFormat === null && (
            <p
              role="alert"
              style={{ fontSize: text.sm, color: color.dangerText, margin: '10px 0 0' }}
            >
              The export could not be prepared.{' '}
              {exportFailure === 'rate_limited'
                ? 'Exports are limited to a few every five minutes — wait, then try again.'
                : exportFailure === 'unauthenticated'
                  ? 'Sign in again to export your data.'
                  : 'Try again, or contact support from Help & glossary if this continues.'}
            </p>
          )}
          <p
            role="status"
            aria-atomic="true"
            style={{
              ...bodyTextStyle,
              margin:
                exportPreparedFormat !== null && !exportFailed && exportPendingFormat === null
                  ? '10px 0 0'
                  : 0,
            }}
          >
            {exportPreparedFormat !== null && !exportFailed && exportPendingFormat === null && (
              <>
                {exportPreparedFormat === 'json'
                  ? 'Selected data (JSON)'
                  : exportCopy.formats[exportPreparedFormat].buttonLabel}{' '}
                prepared. Check your browser&apos;s downloads for the file.
              </>
            )}
          </p>
        </div>
      </Section>

      {/* D147 — the standing surface to change or withdraw the cookie
          choice (GDPR Art. 7(3)); also mounted on the public /cookies page. */}
      <div id="privacy-cookie-preferences" style={{ scrollMarginTop: 24 }}>
        <CookiePreferences />
      </div>

      {/* 5 — leave cleanly (D116's exits, pointing at the owning flows). */}
      <Section title="Leave cleanly">
        <SettingsRow
          label="Disconnect a mailbox"
          detail="Removes DeclutrMail's saved Google credential and stops sync and Gmail actions. Saved Gmail and DeclutrMail data stays so reconnecting can continue its history; Gmail is unchanged. Choose Manage in the top-bar account menu."
        />
        <SettingsRow
          label="Disconnect & delete one mailbox's saved data"
          detail="Also permanently deletes that mailbox's saved email details, sender data, decisions, rules, Activity, and Undo data. Your DeclutrMail account, other mailboxes, disconnected Gmail address, and your email in Gmail remain. Choose Manage in the top-bar account menu."
        />
        <DrillRow href="/settings#account" label="Delete account and data" />
      </Section>

      {/* 6 — legal & evidence (CASA row: static copy per plan). */}
      <Section title="Legal & evidence">
        <SettingsRow
          label="CASA Tier 2 verification"
          detail={
            <>
              DeclutrMail&apos;s Gmail access goes through Google&apos;s CASA security assessment.
              Google approved our OAuth verification on {CASA_VERIFICATION_APPROVED_ON} for the
              single restricted scope we request, gmail.modify. It is recertified annually.
            </>
          }
        />
        <DrillRow href="/privacy" label="Privacy Policy" />
        <DrillRow href="/terms" label="Terms" />
      </Section>
    </div>
  );
}

const EXPORT_FORMATS = ['json', 'csv', 'senders-csv', 'decisions-csv'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `privacy-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, '')}`;
  return (
    <SettingsGroup id={id} title={title}>
      {children}
    </SettingsGroup>
  );
}

const bodyTextStyle = {
  fontSize: text.sm,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: 0,
} as const;

/** A free-form block that sits in a group the way a row does. */
const blockRowStyle = {
  padding: '14px 16px',
} as const;
