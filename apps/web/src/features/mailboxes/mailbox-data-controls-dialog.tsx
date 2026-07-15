'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Eyebrow,
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
  mailboxDataDeletionConfirmPhrase,
  tokens,
  useFocusTrap,
} from '@declutrmail/shared';

import type { MeMailbox } from '@/features/auth/api/use-me';
import { ContextualHelp } from '@/features/help/contextual-help';

const { color, font } = tokens;

/** Everything except the OAuth credential survives standard Disconnect. */
const GMAIL_DISCONNECT_RETAINED_DATA_INVENTORY = Object.freeze([
  ...GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  ...GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
]);

/**
 * D245 mailbox exit dialog. The inventory rows are generated from the same
 * lifecycle registry as Privacy & Data, so this preview cannot drift into a
 * hand-maintained subset of what is removed, deleted, or retained.
 */
export function MailboxDataControlsDialog({
  mailbox,
  onCancel,
  onDisconnect,
  onDeleteIndexedData,
  isDisconnecting,
  isDeleting,
  error,
}: {
  mailbox: MeMailbox | null;
  onCancel: () => void;
  onDisconnect: () => void;
  onDeleteIndexedData: (confirmPhrase: string) => void;
  isDisconnecting: boolean;
  isDeleting: boolean;
  error: string | null;
}) {
  const [typed, setTyped] = useState('');
  const open = mailbox !== null;
  const busy = isDisconnecting || isDeleting;

  useEffect(() => {
    if (open) setTyped('');
  }, [open, mailbox?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);
  if (!mailbox) return null;

  const requiredPhrase = mailboxDataDeletionConfirmPhrase(mailbox.email);
  const phraseMatches = typed === requiredPhrase;
  const alreadyDisconnected = mailbox.status === 'disconnected';

  return (
    <>
      <div
        data-testid="mailbox-data-controls-backdrop"
        onClick={busy ? undefined : onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.48)',
          backdropFilter: 'blur(3px)',
          zIndex: 180,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-mailbox-data-controls-title"
        aria-describedby="dm-mailbox-data-controls-lead"
        style={{
          position: 'fixed',
          top: '7vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(660px, calc(100vw - 28px))',
          maxHeight: '86vh',
          overflow: 'auto',
          background: color.card,
          border: `1px solid ${color.border}`,
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(14,20,19,0.32)',
          zIndex: 181,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow>Mailbox data controls</Eyebrow>
          <h2
            id="dm-mailbox-data-controls-title"
            style={{ fontSize: 19, fontWeight: 600, margin: '6px 0 0', color: color.fg }}
          >
            {alreadyDisconnected
              ? `Manage data for ${mailbox.email}`
              : `Disconnect ${mailbox.email}?`}
          </h2>
          <p
            id="dm-mailbox-data-controls-lead"
            style={{ fontSize: 13, color: color.fgSoft, lineHeight: 1.5, margin: '8px 0 0' }}
          >
            {alreadyDisconnected
              ? 'Gmail access and sync are already stopped. Choose whether to keep or permanently delete this mailbox’s indexed data.'
              : 'Choose what DeclutrMail should do with data from this Gmail account.'}{' '}
            Neither choice deletes or changes mail in Gmail.
          </p>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ContextualHelp question="Which mailbox exit should I choose?">
            Keep indexed data if you may reconnect and want to continue with the same history.
            Delete indexed data if you want this mailbox&apos;s product data permanently removed.
            Both choices stop Google access and leave Gmail mail unchanged; deletion also ends any
            remaining Activity Undo for this mailbox.
          </ContextualHelp>

          {!alreadyDisconnected && (
            <section style={optionStyle(false)} aria-labelledby="dm-disconnect-keep-title">
              <h3 id="dm-disconnect-keep-title" style={optionTitleStyle}>
                Disconnect and keep indexed data
              </h3>
              <p style={optionBodyStyle}>
                Removes DeclutrMail’s saved Google credential and stops sync and Gmail actions. The
                exact indexed and derived categories below stay in DeclutrMail, and reconnecting
                continues with this history. Gmail is unchanged.
              </p>
              <InventoryList
                title="Removed on disconnect"
                items={GMAIL_DISCONNECT_DATA_INVENTORY}
              />
              <InventoryList
                title="Retained after disconnect"
                items={GMAIL_DISCONNECT_RETAINED_DATA_INVENTORY}
              />
              <div style={{ marginTop: 12 }}>
                <Button tone="default" onClick={onDisconnect} disabled={busy}>
                  {isDisconnecting ? 'Disconnecting…' : 'Disconnect and keep data'}
                </Button>
              </div>
            </section>
          )}

          <section style={optionStyle(true)} aria-labelledby="dm-disconnect-delete-title">
            <h3
              id="dm-disconnect-delete-title"
              style={{ ...optionTitleStyle, color: color.danger }}
            >
              {alreadyDisconnected ? 'Delete indexed data' : 'Disconnect & delete indexed data'}
            </h3>
            <p style={optionBodyStyle}>
              {alreadyDisconnected
                ? 'Permanently deletes this mailbox’s indexed message details and derived product data from DeclutrMail.'
                : 'Removes the saved Google credential, stops access, then permanently deletes this mailbox’s indexed message details and derived product data from DeclutrMail.'}{' '}
              Your DeclutrMail account, other mailboxes, and this disconnected Gmail address remain.
              Reconnecting starts a new index.
            </p>
            <InventoryList
              title="Deleted from DeclutrMail"
              items={GMAIL_INDEXED_DATA_DELETION_INVENTORY}
            />
            <InventoryList
              title="Retained after deletion"
              items={GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY}
            />
            <p
              style={{
                margin: '12px 0 0',
                padding: '9px 10px',
                borderRadius: 8,
                color: color.danger,
                background: color.dangerBg,
                border: `1px solid ${color.dangerBorder}`,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Past Gmail actions stay applied. Any remaining Activity Undo for this mailbox ends
              when deletion completes. Gmail mail and labels are not changed by this deletion.
            </p>
            <label
              htmlFor="dm-mailbox-data-delete-phrase"
              style={{ display: 'block', marginTop: 12, fontSize: 12, color: color.fgMuted }}
            >
              Type <strong style={{ fontFamily: font.mono }}>{requiredPhrase}</strong> to continue
            </label>
            <input
              id="dm-mailbox-data-delete-phrase"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={requiredPhrase}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: 6,
                padding: '9px 11px',
                borderRadius: 8,
                border: `1px solid ${phraseMatches ? color.emerald : color.border}`,
                background: color.paper,
                color: color.fg,
                fontFamily: font.mono,
                fontSize: 13,
              }}
            />
            <div style={{ marginTop: 10 }}>
              <Button
                tone="danger"
                onClick={() => onDeleteIndexedData(typed)}
                disabled={!phraseMatches || busy}
              >
                {isDeleting
                  ? 'Starting deletion…'
                  : alreadyDisconnected
                    ? 'Delete indexed data'
                    : 'Disconnect & delete indexed data'}
              </Button>
            </div>
          </section>

          {error && (
            <div
              role="alert"
              style={{
                padding: '9px 10px',
                borderRadius: 8,
                color: color.danger,
                background: color.dangerBg,
                border: `1px solid ${color.dangerBorder}`,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '13px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <Button tone="default" onClick={onCancel} disabled={busy}>
            Keep current setup
          </Button>
        </div>
      </div>
    </>
  );
}

function InventoryList({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', color: color.fg, fontSize: 12, fontWeight: 600 }}>
        {title} ({items.length} {items.length === 1 ? 'category' : 'categories'})
      </summary>
      <ul style={{ margin: '7px 0 0', paddingLeft: 20, color: color.fgMuted, fontSize: 12 }}>
        {items.map((item) => (
          <li key={item.id} style={{ marginBottom: 5, lineHeight: 1.4 }}>
            {item.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

function optionStyle(danger: boolean) {
  return {
    padding: '14px 15px',
    borderRadius: 11,
    border: `1px solid ${danger ? color.dangerBorder : color.border}`,
    background: danger ? color.dangerBg : color.paper,
  } as const;
}

const optionTitleStyle = { margin: 0, color: color.fg, fontSize: 15, fontWeight: 600 } as const;
const optionBodyStyle = {
  margin: '6px 0 0',
  color: color.fgSoft,
  fontSize: 12.5,
  lineHeight: 1.52,
} as const;
