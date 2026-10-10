import {
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
  tokens,
  type GmailDataProcessor,
} from '@declutrmail/shared';
import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { CookiePreferences } from '@/features/consent/cookie-preferences';
import { DrillRow, SettingsGroup, SettingsRow } from '../settings-list';

const { color, text, motion, radius, shadow } = tokens;

/** Only display strings cross the client boundary, never registry-derived dataset IDs. */
export type PrivacyDataExportCopy = {
  limitation: string;
  jsonDescription: string;
  formats: Record<DataExportFormat, { buttonLabel: string; pendingLabel: string }>;
};

function exportFormatCopy(format: DataExportFormat) {
  const { buttonLabel, pendingLabel } = DATA_EXPORT_FORMAT_MANIFEST[format];
  return { buttonLabel, pendingLabel };
}

/** Canonical copy is resolved on the server without shipping the full data registry. */
export const PRIVACY_DATA_EXPORT_COPY: PrivacyDataExportCopy = {
  limitation: DATA_EXPORT_LIMITATION,
  jsonDescription: DATA_EXPORT_FORMAT_MANIFEST.json.description,
  formats: {
    json: exportFormatCopy('json'),
    csv: exportFormatCopy('csv'),
    'senders-csv': exportFormatCopy('senders-csv'),
    'decisions-csv': exportFormatCopy('decisions-csv'),
  },
};

/**
 * Static trust content is rendered by the server page, then passed into the
 * client controller as a ReactNode. Native disclosures need no client handlers.
 * Stories and tests render this same content instead of a parallel fixture.
 */
export function PrivacyDataContent() {
  return (
    <>
      {/* 1 — the D228 trust badge (locked copy module). The storage
        boundary is stated HERE and nowhere else on the page. */}
      <PrivacyBadge
        headingLevel={2}
        variant="card"
        style={{ border: 'none', borderRadius: radius.xl, boxShadow: shadow.card }}
      />

      <SettingsGroup id="privacy-gmail-data-inventory" title="Gmail data inventory">
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
      </SettingsGroup>
    </>
  );
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

/** Static settings guidance is server-composed; only the consent radios hydrate. */
export function PrivacyDataFooter() {
  return (
    <>
      {/* D147 — the standing surface to change or withdraw the cookie
          choice (GDPR Art. 7(3)); also mounted on the public /cookies page. */}
      <div id="privacy-cookie-preferences" style={{ scrollMarginTop: 24 }}>
        <CookiePreferences />
      </div>

      {/* 5 — leave cleanly (D116's exits, pointing at the owning flows). */}
      <SettingsGroup id="privacy-leave-cleanly" title="Leave cleanly">
        <SettingsRow
          label="Disconnect a mailbox"
          detail="Removes DeclutrMail's saved Google credential and stops sync and Gmail actions. Saved Gmail and DeclutrMail data stays so reconnecting can continue its history; Gmail is unchanged. Choose Manage in the top-bar account menu."
        />
        <SettingsRow
          label="Disconnect & delete one mailbox's saved data"
          detail="Also permanently deletes that mailbox's saved email details, sender data, decisions, rules, Activity, and Undo data. Your DeclutrMail account, other mailboxes, disconnected Gmail address, and your email in Gmail remain. Choose Manage in the top-bar account menu."
        />
        <DrillRow href="/settings#account" label="Delete account and data" />
      </SettingsGroup>

      {/* 6 — legal & evidence (CASA row: static copy per plan). */}
      <SettingsGroup id="privacy-legal-evidence" title="Legal & evidence">
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
      </SettingsGroup>
    </>
  );
}
