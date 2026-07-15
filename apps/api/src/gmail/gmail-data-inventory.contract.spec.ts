import { getTableColumns } from 'drizzle-orm';
import { mailMessages, mailboxAccounts, providerSyncState, senders, users } from '@declutrmail/db';
import {
  GMAIL_DATA_INVENTORY,
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
  GMAIL_MESSAGE_DATA_INVENTORY,
  GMAIL_METADATA_HEADERS,
} from '@declutrmail/shared/contracts';
import { describe, expect, it } from 'vitest';

/** App-owned row bookkeeping rather than data fetched or derived from Gmail. */
const MESSAGE_INDEX_BOOKKEEPING_COLUMNS = new Set([
  'id',
  'mailbox_account_id',
  'created_at',
  'updated_at',
]);

describe('D245 Gmail data inventory contract', () => {
  it('has stable, unique item identifiers and lifecycle metadata', () => {
    const ids = GMAIL_DATA_INVENTORY.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const item of GMAIL_DATA_INVENTORY) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.purpose.length).toBeGreaterThan(0);
      expect(item.retention.length).toBeGreaterThan(0);
      expect(item.storageRefs.length).toBeGreaterThan(0);
      expect(item.transmittedTo).toContain('DeclutrMail');
      expect(['disconnect', 'delete-indexed-data', 'delete-account', 'retention-policy']).toContain(
        item.removalTrigger,
      );
    }
  });

  it('generates complete, non-overlapping disconnect, purge, and retained scopes', () => {
    expect(GMAIL_DISCONNECT_DATA_INVENTORY.map((item) => item.id)).toEqual(['oauth-credential']);
    expect(GMAIL_INDEXED_DATA_DELETION_INVENTORY).not.toHaveLength(0);
    expect(GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY.map((item) => item.id)).toEqual([
      'gmail-account-identity',
      'mailbox-security-and-deletion-audit',
    ]);

    const generatedIds = [
      ...GMAIL_DISCONNECT_DATA_INVENTORY,
      ...GMAIL_INDEXED_DATA_DELETION_INVENTORY,
      ...GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
    ].map((item) => item.id);
    expect(new Set(generatedIds)).toEqual(new Set(GMAIL_DATA_INVENTORY.map((item) => item.id)));
    expect(generatedIds).toHaveLength(GMAIL_DATA_INVENTORY.length);
  });

  it('generates the exact Gmail metadata-header request allowlist', () => {
    expect(GMAIL_METADATA_HEADERS).toEqual([
      'From',
      'Subject',
      'To',
      'Cc',
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
    ]);
  });

  it('classifies every persisted Gmail message-index column', () => {
    const schemaColumns = Object.values(getTableColumns(mailMessages))
      .map((column) => column.name)
      .filter((name) => !MESSAGE_INDEX_BOOKKEEPING_COLUMNS.has(name))
      .sort();

    const registeredColumns = GMAIL_MESSAGE_DATA_INVENTORY.flatMap((item) => item.storageRefs)
      .filter((ref) => ref.startsWith('mail_messages.'))
      .map((ref) => ref.slice('mail_messages.'.length))
      .sort();

    expect(registeredColumns).toEqual(schemaColumns);
  });

  it('references real columns for every concrete raw/connection storage field', () => {
    const tableColumns = new Map<string, Set<string>>([
      ['mail_messages', columnNames(mailMessages)],
      ['mailbox_accounts', columnNames(mailboxAccounts)],
      ['provider_sync_state', columnNames(providerSyncState)],
      ['senders', columnNames(senders)],
      ['users', columnNames(users)],
    ]);

    for (const ref of GMAIL_DATA_INVENTORY.flatMap((item) => item.storageRefs)) {
      if (ref.endsWith('.*')) continue;
      const [table, column] = ref.split('.');
      expect(table, `unknown inventory table in ${ref}`).toBeTruthy();
      expect(column, `missing inventory column in ${ref}`).toBeTruthy();
      expect(tableColumns.get(table!), `unvalidated inventory table in ${ref}`).toBeDefined();
      expect(tableColumns.get(table!)).toContain(column);
    }
  });
});

function columnNames(table: Parameters<typeof getTableColumns>[0]): Set<string> {
  return new Set(Object.values(getTableColumns(table)).map((column) => column.name));
}
