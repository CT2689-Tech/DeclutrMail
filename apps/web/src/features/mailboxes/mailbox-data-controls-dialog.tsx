'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
  mailboxDataDeletionConfirmPhrase,
  tokens,
} from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import type { MeMailbox } from '@/features/auth/api/use-me';

const { color, font, radius, shadow, space, text } = tokens;

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
    // The shared sheet shell: a centred dialog on desktop, a bottom sheet
    // on phones — pure CSS, so no post-hydration jump.
    <div
      data-testid="mailbox-data-controls-backdrop"
      className="dm-scrim dm-sheet-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 180,
        display: 'flex',
        justifyContent: 'center',
        padding: space[4],
        overflowY: 'auto',
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-mailbox-data-controls-title"
        aria-describedby="dm-mailbox-data-controls-lead"
        className="dm-sheet dm-sheet-panel"
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
          overflow: 'auto',
          background: color.card,
          boxShadow: shadow.modal,
          fontFamily: font.sans,
          color: color.fg,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div style={{ padding: '28px 28px 8px' }}>
          <h2
            id="dm-mailbox-data-controls-title"
            style={{
              fontSize: text.xl,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              margin: 0,
              color: color.fg,
              overflowWrap: 'anywhere',
            }}
          >
            {alreadyDisconnected
              ? `Manage data for ${mailbox.email}`
              : `Disconnect ${mailbox.email}?`}
          </h2>
          <p
            id="dm-mailbox-data-controls-lead"
            style={{ fontSize: text.md, color: color.fgSoft, lineHeight: 1.5, margin: '8px 0 0' }}
          >
            {alreadyDisconnected
              ? 'Gmail access and sync are already stopped. Choose whether to keep or permanently delete this mailbox’s saved data.'
              : 'Choose what DeclutrMail should do with data from this Gmail account.'}{' '}
            Neither option deletes or changes email in Gmail.
          </p>
        </div>

        <div style={{ padding: '8px 28px', display: 'flex', flexDirection: 'column' }}>
          {!alreadyDisconnected && (
            <section style={optionStyle(false)} aria-labelledby="dm-disconnect-keep-title">
              <h3 id="dm-disconnect-keep-title" style={optionTitleStyle}>
                Disconnect and keep saved data
              </h3>
              <p style={optionBodyStyle}>
                Removes DeclutrMail’s saved Google credential and stops sync and Gmail actions. The
                exact saved Gmail and DeclutrMail categories below stay, and reconnecting continues
                with this history. Gmail is unchanged.
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
                <Button tone="default" size="lg" onClick={onDisconnect} disabled={busy}>
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
              {alreadyDisconnected ? 'Delete saved data' : 'Disconnect & delete saved data'}
            </h3>
            <p style={optionBodyStyle}>
              {alreadyDisconnected
                ? 'Permanently deletes this mailbox’s saved email details and related data from DeclutrMail.'
                : 'Removes the saved Google credential, stops access, then permanently deletes this mailbox’s saved email details and related data from DeclutrMail.'}{' '}
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
                color: color.danger,
                fontSize: text.sm,
                lineHeight: 1.5,
              }}
            >
              Past Gmail actions stay applied. Any remaining Activity Undo for this mailbox ends
              when deletion completes. Gmail email and labels are not changed by this deletion.
            </p>
            <label
              htmlFor="dm-mailbox-data-delete-phrase"
              style={{ display: 'block', marginTop: 16, fontSize: text.sm, color: color.fgMuted }}
            >
              Type{' '}
              <strong style={{ color: color.fg, fontWeight: 600, overflowWrap: 'anywhere' }}>
                {requiredPhrase}
              </strong>{' '}
              to continue
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
                height: 44,
                padding: '0 14px',
                borderRadius: radius.md,
                border: 'none',
                boxShadow: phraseMatches ? `inset 0 0 0 1.5px ${color.emerald}` : 'none',
                background: color.fill,
                color: color.fg,
                fontFamily: font.sans,
                fontSize: text.md,
              }}
            />
            <div style={{ marginTop: 10 }}>
              <Button
                tone="danger"
                size="lg"
                onClick={() => onDeleteIndexedData(typed)}
                disabled={!phraseMatches || busy}
              >
                {isDeleting
                  ? 'Starting deletion…'
                  : alreadyDisconnected
                    ? 'Delete saved data'
                    : 'Disconnect & delete saved data'}
              </Button>
            </div>
          </section>

          {error && (
            <div
              role="alert"
              style={{
                margin: '8px 0 12px',
                padding: '10px 12px',
                borderRadius: radius.md,
                color: color.danger,
                background: color.dangerBg,
                fontSize: text.sm,
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
            padding: '12px 28px 28px',
          }}
        >
          <Button tone="default" size="lg" onClick={onCancel} disabled={busy}>
            Keep current setup
          </Button>
        </div>
      </div>
    </div>
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
      <summary style={{ cursor: 'pointer', color: color.fg, fontSize: text.sm, fontWeight: 600 }}>
        {title} ({items.length} {items.length === 1 ? 'category' : 'categories'})
      </summary>
      <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: color.fgSoft, fontSize: text.sm }}>
        {items.map((item) => (
          <li key={item.id} style={{ marginBottom: 5, lineHeight: 1.4 }}>
            {item.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Two plain sections on one surface, split by a hairline — no boxes inside the sheet. */
function optionStyle(danger: boolean) {
  return {
    padding: '20px 0',
    borderTop: danger ? `1px solid ${color.lineSoft}` : 'none',
  } as const;
}

const optionTitleStyle = {
  margin: 0,
  color: color.fg,
  fontSize: text.lg,
  fontWeight: 600,
  letterSpacing: '-0.01em',
} as const;
const optionBodyStyle = {
  margin: '6px 0 0',
  color: color.fgSoft,
  fontSize: text.sm,
  lineHeight: 1.55,
} as const;
