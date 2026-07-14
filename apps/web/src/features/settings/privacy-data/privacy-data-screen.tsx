'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  GMAIL_CONNECTION_DATA_INVENTORY,
  GMAIL_DATA_PROCESSORS,
  GMAIL_DERIVED_DATA_INVENTORY,
  GMAIL_MESSAGE_DATA_INVENTORY,
  GMAIL_OAUTH_ACCESS,
  PrivacyBadge,
  ScreenIntro,
  tokens,
} from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { track } from '@/lib/posthog';
import { useBillingSubscription } from '../api/use-billing-subscription';
import { useDataExport } from '../api/use-data-export';

const { color, font } = tokens;

/**
 * Settings → Privacy & Data (D116 + D217 + D228) — the dedicated
 * trust sub-page.
 *
 *   1. <PrivacyBadge variant="card"> — the D228 locked copy ("Full
 *      bodies fetched: 0" + the explicit storage list). Copy literals
 *      live ONLY in packages/shared/src/copy/privacy.ts.
 *   2. Indexed mailboxes — which accounts the storage list applies to.
 *   3. Undo retention — how long reversible actions stay reversible.
 *   4. Data export — JSON (everything) plus per-dataset CSVs (message
 *      index / senders / decisions) via GET /api/account/export.
 *      D228-allowlisted columns only.
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
        id="settings-privacy"
        title="Privacy & Data"
        body={
          <>
            Exactly what DeclutrMail stores about your mail, what it never touches, and how to take
            your data with you — or leave entirely.
          </>
        }
      />

      {/* 1 — the D228 trust badge (locked copy module). */}
      <PrivacyBadge variant="card" />

      <Card padding={0}>
        <div style={{ padding: '18px 20px' }}>
          <h3 style={cardTitleStyle}>Complete Gmail data inventory</h3>
          <p style={mutedTextStyle}>
            Google grants broader account access than DeclutrMail uses. These are the exact access
            purposes and the fetched, stored, derived, exported, transmitted, and retained data
            contracts implemented by the product.
          </p>
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
          <p style={{ ...mutedTextStyle, marginTop: 12 }}>
            Anthropic receives only the inventory items marked for generated Brief narratives or
            optional sender explanations. {GMAIL_DATA_PROCESSORS.Anthropic.retention}
          </p>
        </div>
      </Card>

      {/* 2 — which mailboxes the storage list applies to. */}
      <Card padding={0}>
        <div style={{ padding: '18px 20px' }}>
          <h3 style={cardTitleStyle}>Indexed mailboxes</h3>
          {mailboxes.length === 0 ? (
            <p style={mutedTextStyle}>
              No mailboxes connected — nothing is being indexed right now.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
              {mailboxes.map((m, i) => (
                <li
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 0',
                    borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1, fontFamily: font.mono, fontSize: 12.5 }}>{m.email}</span>
                  <span style={{ fontSize: 11, color: color.fgMuted }}>
                    {m.status === 'disconnected' ? 'disconnected — sync stopped' : 'indexed'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* 3 — undo retention. */}
      <Card padding={0}>
        <div style={{ padding: '18px 20px' }}>
          <h3 style={cardTitleStyle}>Undo retention</h3>
          <p style={mutedTextStyle}>
            {undoDays !== null ? (
              <>
                Archive, Later, and archived unsubscribe backlogs can be undone from Activity for{' '}
                <strong style={{ color: color.fg }}>{undoDays} days</strong> on your plan.
              </>
            ) : (
              <>
                Archive, Later, and archived unsubscribe backlogs can be undone from Activity for{' '}
                {TIER_MANIFEST.free.undoWindowDays} days ({TIER_MANIFEST.pro.undoWindowDays} days on
                Pro).
              </>
            )}{' '}
            Delete uses Gmail Trash recovery for up to 30 days; a completed unsubscribe cannot be
            recalled. Account deletion waits for open Activity undo windows unless you explicitly
            waive them.
          </p>
        </div>
      </Card>

      {/* 4 — data export (D116 + DPDP). */}
      <Card padding={0}>
        <div style={{ padding: '18px 20px' }}>
          <h3 style={cardTitleStyle}>Export my data</h3>
          <p style={mutedTextStyle}>
            Download everything DeclutrMail stores for your account. JSON contains the full export —
            mailboxes, senders with your decisions, the message metadata index, and your activity
            log. The CSVs cover one dataset each: the message metadata index, your senders with
            their standing policies, and your decision history. Exports never contain message bodies
            or OAuth tokens — we don't store them.
          </p>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              tone="default"
              disabled={exportPendingFormat !== null}
              onClick={() => onExport('json')}
            >
              {exportPendingFormat === 'json' ? 'Preparing JSON…' : 'Download JSON'}
            </Button>
            <Button
              tone="default"
              disabled={exportPendingFormat !== null}
              onClick={() => onExport('csv')}
            >
              {exportPendingFormat === 'csv' ? 'Preparing CSV…' : 'Messages CSV'}
            </Button>
            <Button
              tone="default"
              disabled={exportPendingFormat !== null}
              onClick={() => onExport('senders-csv')}
            >
              {exportPendingFormat === 'senders-csv' ? 'Preparing CSV…' : 'Senders CSV'}
            </Button>
            <Button
              tone="default"
              disabled={exportPendingFormat !== null}
              onClick={() => onExport('decisions-csv')}
            >
              {exportPendingFormat === 'decisions-csv' ? 'Preparing CSV…' : 'Decisions CSV'}
            </Button>
          </div>
          {exportFailed && (
            <p role="alert" style={{ fontSize: 12, color: color.danger, margin: '10px 0 0' }}>
              The export could not be prepared. Wait a moment and try again — large mailboxes are
              rate-limited to a few exports per five minutes.
            </p>
          )}
        </div>
      </Card>

      {/* 5 — leave cleanly (D116's exits, pointing at the owning flows). */}
      <Card padding={0}>
        <div style={{ padding: '18px 20px' }}>
          <h3 style={cardTitleStyle}>Leave cleanly</h3>
          <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
            <li style={{ ...exitRowStyle, borderTop: 'none' }}>
              <div>
                <div style={exitTitleStyle}>Disconnect a mailbox</div>
                <div style={exitDetailStyle}>
                  Revokes DeclutrMail's Gmail access and stops sync for that account. Use the
                  account menu in the top bar.
                </div>
              </div>
            </li>
            <li style={exitRowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={exitTitleStyle}>Delete account and data</div>
                <div style={exitDetailStyle}>
                  Permanently removes everything, with a grace period and a typed confirmation.
                </div>
              </div>
              <Link href="/settings#account" style={{ textDecoration: 'none' }}>
                <Button tone="default" size="sm">
                  Open in Account
                </Button>
              </Link>
            </li>
          </ul>
        </div>
      </Card>

      {/* 6 — legal & evidence (CASA row: static copy per plan). */}
      <Card padding={0}>
        <div style={{ padding: '18px 20px' }}>
          <h3 style={cardTitleStyle}>Legal &amp; evidence</h3>
          <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
            <li style={{ ...exitRowStyle, borderTop: 'none' }}>
              <div>
                <div style={exitTitleStyle}>CASA Tier 2 verification</div>
                <div style={exitDetailStyle}>
                  DeclutrMail's Gmail access goes through Google's CASA security assessment. The
                  assessment letter will be linked here once the current cycle's letter is issued.
                </div>
              </div>
            </li>
            <li style={exitRowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={exitTitleStyle}>Privacy Policy &amp; Terms of Service</div>
                <div style={exitDetailStyle}>
                  Exactly what we store and the terms you agree to — both are published and current.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <Link href="/privacy" style={{ textDecoration: 'none' }}>
                  <Button tone="default" size="sm">
                    Privacy Policy
                  </Button>
                </Link>
                <Link href="/terms" style={{ textDecoration: 'none' }}>
                  <Button tone="default" size="sm">
                    Terms
                  </Button>
                </Link>
              </div>
            </li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

function inventoryDisplayItem(item: {
  id: string;
  label: string;
  purpose: string;
  retention: string;
  exportedIn: readonly string[];
  transmittedTo: readonly string[];
}) {
  const exportDetail =
    item.exportedIn.length > 0
      ? `Included in: ${item.exportedIn.join(', ')}.`
      : 'Not currently included in a data export.';
  const processorDetail = item.transmittedTo.includes('Anthropic')
    ? ' May be sent to Anthropic for generated text.'
    : '';
  return {
    id: item.id,
    label: item.label,
    detail: `${item.purpose} ${item.retention} ${exportDetail}${processorDetail}`,
  };
}

function InventoryGroup({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ id: string; label: string; detail: string }>;
}) {
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: color.fg }}>{title}</summary>
      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
        {items.map((item) => (
          <li key={item.id} style={{ marginBottom: 8, color: color.fgMuted, lineHeight: 1.5 }}>
            <strong style={{ color: color.fg }}>{item.label}</strong> — {item.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}

const cardTitleStyle = {
  fontSize: 15,
  fontWeight: 600,
  margin: 0,
  color: color.fg,
} as const;

const mutedTextStyle = {
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: '8px 0 0',
} as const;

const exitRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 0',
  borderTop: `1px solid ${color.lineSoft}`,
} as const;

const exitTitleStyle = { fontSize: 13.5, fontWeight: 500, color: color.fg } as const;

const exitDetailStyle = { fontSize: 12, color: color.fgMuted, marginTop: 2 } as const;
