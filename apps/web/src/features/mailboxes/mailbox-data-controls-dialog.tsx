'use client';

import { useEffect, useState, type RefObject } from 'react';
import {
  Button,
  DialogFrame,
  Disclosure,
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
  mailboxDataDeletionConfirmPhrase,
  tokens,
} from '@declutrmail/shared';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import type { MeMailbox } from '@/features/auth/api/use-me';

const { color, font, radius, text } = tokens;

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
  returnFocusRef,
}: {
  mailbox: MeMailbox | null;
  onCancel: () => void;
  onDisconnect: () => void;
  onDeleteIndexedData: (confirmPhrase: string) => void;
  isDisconnecting: boolean;
  isDeleting: boolean;
  error: string | null;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
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

  const trapRef = useFocusTrap<HTMLDivElement>(open, {
    initialFocusSelector: '#dm-mailbox-data-cancel',
    ...(returnFocusRef ? { returnFocusRef } : {}),
  });
  if (!mailbox) return null;

  const requiredPhrase = mailboxDataDeletionConfirmPhrase(mailbox.email);
  const phraseMatches = typed === requiredPhrase;
  const alreadyDisconnected = mailbox.status === 'disconnected';

  return (
    <DialogFrame
      panelRef={trapRef}
      role="alertdialog"
      titleId="dm-mailbox-data-controls-title"
      descriptionId="dm-mailbox-data-controls-lead"
      backdropTestId="mailbox-data-controls-backdrop"
      onDismiss={busy ? undefined : onCancel}
      maxWidth={620}
      zIndex={180}
      footer={
        <>
          <Button
            id="dm-mailbox-data-cancel"
            tone="ghost"
            size="lg"
            onClick={onCancel}
            disabled={busy}
          >
            Keep current setup
          </Button>
        </>
      }
    >
      <div>
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
            ? 'DeclutrMail no longer has access to this Gmail account. Keep its saved data, or delete it for good.'
            : 'Choose what DeclutrMail should do with data from this Gmail account.'}{' '}
          Neither option deletes or changes email in Gmail.
        </p>
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column' }}>
        {!alreadyDisconnected && (
          <section style={optionStyle(false)} aria-labelledby="dm-disconnect-keep-title">
            <h3 id="dm-disconnect-keep-title" style={optionTitleStyle}>
              Disconnect and keep saved data
            </h3>
            <p style={optionBodyStyle}>
              DeclutrMail stops accessing this Gmail account. Your saved data stays, so you can
              reconnect later.
            </p>
            <InventoryDisclosure
              removed={GMAIL_DISCONNECT_DATA_INVENTORY}
              keptHeading={WS2_COPY.simplify.dataControls.keptAfterDisconnect}
              kept={GMAIL_DISCONNECT_RETAINED_DATA_INVENTORY}
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
            style={{ ...optionTitleStyle, color: color.dangerText }}
          >
            {alreadyDisconnected ? 'Delete saved data' : 'Disconnect & delete saved data'}
          </h3>
          <p style={optionBodyStyle}>
            {alreadyDisconnected
              ? 'Permanently deletes this Gmail account’s saved email details and related data from DeclutrMail.'
              : 'Removes the saved Gmail access details, stops access, then permanently deletes this Gmail account’s saved email details and related data from DeclutrMail.'}{' '}
            Your DeclutrMail account, other Gmail accounts, and this disconnected Gmail address
            remain. {WS2_COPY.liveFix.mailboxes.deleteReconnect}
          </p>
          <InventoryDisclosure
            removed={GMAIL_INDEXED_DATA_DELETION_INVENTORY}
            keptHeading={WS2_COPY.simplify.dataControls.keptAfterDelete}
            kept={GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY}
          />
          <p
            style={{
              margin: '12px 0 0',
              color: color.dangerText,
              fontSize: text.sm,
              lineHeight: 1.5,
            }}
          >
            Changes already made in Gmail stay. Undo for this account ends when the deletion
            finishes. Your email and labels in Gmail don’t change.
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
              color: color.dangerText,
              background: color.dangerBg,
              fontSize: text.sm,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </DialogFrame>
  );
}

function InventoryDisclosure({
  removed,
  keptHeading,
  kept,
}: {
  removed: ReadonlyArray<{ id: string; label: string }>;
  keptHeading: string;
  kept: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
    <Disclosure summary={WS2_COPY.simplify.dataControls.inventoryToggle} style={{ marginTop: 10 }}>
      <ul style={inventoryListStyle}>
        {removed.map((item) => (
          <li key={item.id} style={inventoryItemStyle}>
            {item.label}
          </li>
        ))}
      </ul>
      <h4 style={keptHeadingStyle}>{keptHeading}</h4>
      <ul style={inventoryListStyle}>
        {kept.map((item) => (
          <li key={item.id} style={inventoryItemStyle}>
            {item.label}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

const inventoryListStyle = {
  margin: 0,
  paddingLeft: 20,
  color: color.fg,
  fontSize: text.sm,
} as const;
const inventoryItemStyle = { marginBottom: 5, lineHeight: 1.4 } as const;
const keptHeadingStyle = {
  margin: '12px 0 6px',
  color: color.fg,
  fontSize: text.sm,
  fontWeight: 600,
} as const;

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
