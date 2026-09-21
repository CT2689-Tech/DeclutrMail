'use client';

import { useEffect } from 'react';
import {
  Button,
  CASA_VERIFICATION_APPROVED_ON,
  DATA_EXPORT_FORMAT_MANIFEST,
  DATA_EXPORT_LIMITATION,
  GMAIL_CONNECTION_DATA_INVENTORY,
  GMAIL_DATA_PROCESSORS,
  GMAIL_DERIVED_DATA_INVENTORY,
  GMAIL_MESSAGE_DATA_INVENTORY,
  GMAIL_OAUTH_ACCESS,
  GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY,
  PrivacyBadge,
  ScreenIntro,
  tokens,
  type GmailDataProcessor,
} from '@declutrmail/shared';
import { MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';
import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { CookiePreferences } from '@/features/consent/cookie-preferences';
import { track } from '@/lib/posthog';
import { useBillingSubscription } from '@/features/billing/api/use-billing-subscription';
import { useDataExport } from '../api/use-data-export';
import { DrillRow, PageHeader, SettingsGroup, SettingsRow } from '../settings-list';

const { color, font, text, motion, radius, shadow } = tokens;

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
export function PrivacyDataRoute() {
  const { me } = useAuth();
  const billing = useBillingSubscription();
  const exporter = useDataExport();

  const tier = billing.data?.tier ?? null;
  const undoDays = tier && tier in TIER_MANIFEST ? TIER_MANIFEST[tier].undoWindowDays : null;

  return (
    <PrivacyDataView
      mailboxes={me.mailboxes}
      undoDays={undoDays}
      exportPendingFormat={exporter.isPending ? (exporter.variables ?? null) : null}
      exportFailed={exporter.isError}
      onExport={(format) => exporter.mutate(format)}
    />
  );
}

/** Dumb view — storyable without auth/query shims. */
export function PrivacyDataView({
  mailboxes,
  undoDays,
  exportPendingFormat,
  exportFailed,
  onExport,
}: {
  mailboxes: MeMailbox[];
  /** Tier-resolved undo window; null while the tier is unknown. */
  undoDays: number | null;
  exportPendingFormat: DataExportFormat | null;
  exportFailed: boolean;
  onExport: (format: DataExportFormat) => void;
}) {
  useEffect(() => {
    void track('page_viewed', { page: 'settings', mailbox_id: null });
  }, []);

  return (
    <div
      className="dm-settings-page"
      style={{
        padding: '20px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <style>{`@media (max-width: 480px) { .dm-settings-page { padding-left: 16px !important; padding-right: 16px !important; } }`}</style>
      <PageHeader title="Privacy & data" backToSettings />
      <ScreenIntro
        id="settings-privacy"
        title="Privacy & data"
        body="What DeclutrMail fetches, saves, shares and deletes — Google grants broader access than it uses."
      />

      {/* 1 — the D228 trust badge (locked copy module). The storage
          boundary is stated HERE and nowhere else on the page. */}
      <PrivacyBadge
        variant="card"
        style={{ border: 'none', borderRadius: radius.xl, boxShadow: shadow.card }}
      />

      <Section title="Gmail data inventory">
        <InventoryGroup
          title="Access granted"
          items={GMAIL_OAUTH_ACCESS.map((item) => ({
            id: item.scope,
            label: item.label,
            detail: item.usedFor,
          }))}
        />
        <InventoryGroup
          title="Connection and sync data"
          items={GMAIL_CONNECTION_DATA_INVENTORY.map(inventoryDisplayItem)}
        />
        <InventoryGroup
          title="Message data"
          items={GMAIL_MESSAGE_DATA_INVENTORY.map(inventoryDisplayItem)}
        />
        <InventoryGroup
          title="Derived product data"
          items={GMAIL_DERIVED_DATA_INVENTORY.map(inventoryDisplayItem)}
        />
        <InventoryGroup
          title="Records we keep to investigate problems"
          items={GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY.map(inventoryDisplayItem)}
        />
        <p className="dm-settings-row" style={{ ...bodyTextStyle, padding: '14px 16px 0' }}>
          Anthropic only ever sees the items marked above for Brief summaries or optional sender
          explanations. {GMAIL_DATA_PROCESSORS.Anthropic.retention}
        </p>
        <p style={{ ...bodyTextStyle, padding: '8px 16px 14px' }}>
          Brandfetch receives a sender&rsquo;s email domain and nothing else about you — never your
          address, your account, or any message. {GMAIL_DATA_PROCESSORS.Brandfetch.retention}{' '}
          <a
            href={GMAIL_DATA_PROCESSORS.Brandfetch.privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: color.primary }}
          >
            Brandfetch&rsquo;s privacy policy
          </a>
          .
        </p>
      </Section>

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
            {DATA_EXPORT_LIMITATION} Current JSON includes{' '}
            {DATA_EXPORT_FORMAT_MANIFEST.json.description} The CSVs each cover the dataset named on
            the button. App preferences and billing records are not included.
          </p>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXPORT_FORMATS.map((format) => (
              <Button
                key={format}
                tone="default"
                disabled={exportPendingFormat !== null}
                onClick={() => onExport(format)}
              >
                {exportPendingFormat === format
                  ? DATA_EXPORT_FORMAT_MANIFEST[format].pendingLabel
                  : DATA_EXPORT_FORMAT_MANIFEST[format].buttonLabel}
              </Button>
            ))}
          </div>
          {exportFailed && (
            <p role="alert" style={{ fontSize: text.sm, color: color.danger, margin: '10px 0 0' }}>
              The export could not be prepared. Exports are limited to a few every five minutes —
              wait, then try again.
            </p>
          )}
        </div>
      </Section>

      {/* D147 — the standing surface to change or withdraw the cookie
          choice (GDPR Art. 7(3)); also mounted on the public /cookies page. */}
      <CookiePreferences />

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
  return <SettingsGroup title={title}>{children}</SettingsGroup>;
}

function inventoryDisplayItem(item: {
  id: string;
  label: string;
  purpose: string;
  retention: string;
  exportedIn: readonly string[];
  transmittedTo: readonly GmailDataProcessor[];
  removalTrigger: 'disconnect' | 'delete-indexed-data' | 'delete-account' | 'retention-policy';
}) {
  const exportDetail =
    item.exportedIn.length > 0
      ? `Included in: ${item.exportedIn.join(', ')}.`
      : 'Not currently included in a data export.';
  const processorDetail = item.transmittedTo
    .map((processor) => PROCESSOR_SENTENCE[processor])
    .join('');
  const deletionDetail = deletionTriggerDetail(item.removalTrigger);
  return {
    id: item.id,
    label: item.label,
    detail: `${item.purpose} ${item.retention} ${deletionDetail} ${exportDetail}${processorDetail}`,
  };
}

/**
 * One sentence per processor. Typed against the registry union, so adding
 * a processor there is a compile error here until it has a sentence —
 * the screen cannot silently omit a third party.
 */
const PROCESSOR_SENTENCE: Record<GmailDataProcessor, string> = {
  DeclutrMail: '',
  Anthropic: ' May be sent to Anthropic for generated text.',
  Brandfetch: ' The domain alone may be sent to Brandfetch to find a logo.',
};

function deletionTriggerDetail(
  trigger: 'disconnect' | 'delete-indexed-data' | 'delete-account' | 'retention-policy',
): string {
  switch (trigger) {
    case 'disconnect':
      return 'Removed when this Gmail account is disconnected.';
    case 'delete-indexed-data':
      return 'Deleted when you choose Disconnect & delete saved data, or when you delete your DeclutrMail account.';
    case 'delete-account':
      return 'Retained after one mailbox’s saved data is deleted; deleted with the DeclutrMail account.';
    case 'retention-policy':
      return 'Retained after mailbox or account deletion only under the stated operational retention policy.';
  }
}

/**
 * One inventory category as a disclosure row inside the raised group;
 * open, it is a clean two-column list — what is kept, and everything
 * the registry says about it — with no nested box.
 */
function InventoryGroup({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ id: string; label: string; detail: string }>;
}) {
  return (
    <details className="dm-settings-row dm-inventory">
      <style>{INVENTORY_CSS}</style>
      <summary
        className="dm-inventory-summary"
        style={{
          cursor: 'pointer',
          minHeight: 56,
          boxSizing: 'border-box',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontSize: text.md,
          fontWeight: 500,
          color: color.fg,
          listStyle: 'none',
        }}
      >
        {title}
        <span
          aria-hidden="true"
          className="dm-inventory-chevron"
          style={{ display: 'inline-flex', color: color.fgMuted }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </span>
      </summary>
      <dl style={{ margin: 0, padding: '0 16px 12px' }}>
        {items.map((item) => (
          <div key={item.id} className="dm-inventory-item">
            <dt style={{ fontSize: text.sm, fontWeight: 600, color: color.fg }}>{item.label}</dt>
            <dd style={{ margin: 0, fontSize: text.sm, color: color.fgMuted, lineHeight: 1.5 }}>
              {item.detail}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const INVENTORY_CSS = `.dm-inventory-summary::-webkit-details-marker { display: none; }
.dm-inventory-chevron { transition: transform ${motion.fast} ${motion.ease}; }
.dm-inventory[open] .dm-inventory-chevron { transform: rotate(90deg); }
.dm-inventory-item { display: grid; grid-template-columns: minmax(120px, 34%) 1fr; gap: 16px; padding: 10px 0; border-top: 1px solid ${color.lineSoft}; }
@media (max-width: 560px) { .dm-inventory-item { grid-template-columns: 1fr; gap: 2px; } }`;

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
