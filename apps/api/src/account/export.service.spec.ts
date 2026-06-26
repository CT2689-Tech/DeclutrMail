import { describe, expect, it, vi } from 'vitest';

import { csvField, DataExportService } from './export.service.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * DataExportService tests (D116 + D228) — stream assembly + the
 * privacy pin. The DB batch readers are stubbed (their SQL is
 * explicit-column by construction; integration coverage is the smoke);
 * what these tests own:
 *
 *   1. The JSON stream concatenates to a VALID document across batch
 *      boundaries (comma placement is hand-rolled).
 *   2. The exported key set is EXACTLY the D228 allowlist — a new
 *      column leaking into the export fails here before review.
 *   3. CSV quoting (RFC 4180) for commas / quotes / newlines.
 */

const MAILBOX = {
  id: 'mb-1',
  email: 'user@example.com',
  status: 'active' as const,
  connectedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const SENDER_ROW = {
  id: 's-1',
  name: 'Acme',
  email: 'news@acme.com',
  domain: 'acme.com',
  gmailCategory: 'promotions',
  firstSeenAt: new Date('2025-01-01T00:00:00.000Z'),
  lastSeenAt: new Date('2026-06-01T00:00:00.000Z'),
  totalReceived: 12n as unknown as number,
  policyType: 'archive',
  isVip: false,
  isProtected: null,
  snoozedUntil: null,
};

const MESSAGE_ROW = {
  id: 'm-1',
  senderName: 'Acme',
  senderEmail: 'news@acme.com',
  subject: 'Hello, "world"',
  snippet: 'A short Gmail preview',
  receivedAt: new Date('2026-06-01T10:00:00.000Z'),
  labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
  unread: true,
};

const ACTIVITY_ROW = {
  id: 'a-1',
  occurredAt: new Date('2026-06-02T10:00:00.000Z'),
  source: 'triage',
  action: 'archive',
  affectedCount: 3,
  senderEmail: 'news@acme.com',
};

type AnyBatch = (mailboxId: string, afterId: string | null) => Promise<unknown[]>;

function makeService(opts: {
  mailboxes?: (typeof MAILBOX)[];
  senders?: (typeof SENDER_ROW)[];
  messages?: (typeof MESSAGE_ROW)[];
  activity?: (typeof ACTIVITY_ROW)[];
}) {
  const service = new DataExportService({} as DrizzleDb);
  const svc = service as unknown as {
    listMailboxes: (workspaceId: string) => Promise<unknown[]>;
    senderBatch: AnyBatch;
    messageBatch: AnyBatch;
    activityBatch: AnyBatch;
  };
  svc.listMailboxes = vi.fn().mockResolvedValue(opts.mailboxes ?? [MAILBOX]);
  // Batch stubs: return all rows after the cursor, honoring keyset
  // semantics so multi-batch paths terminate.
  const batched =
    (rows: { id: string }[]): AnyBatch =>
    (_mailboxId, afterId) => {
      const start = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : 0;
      return Promise.resolve(rows.slice(start, start + DataExportService.BATCH_SIZE));
    };
  svc.senderBatch = vi.fn(batched(opts.senders ?? []));
  svc.messageBatch = vi.fn(batched(opts.messages ?? []));
  svc.activityBatch = vi.fn(batched(opts.activity ?? []));
  return service;
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of gen) out += chunk;
  return out;
}

describe('DataExportService.streamJson', () => {
  it('assembles a valid JSON document with all three datasets', async () => {
    const service = makeService({
      senders: [SENDER_ROW],
      messages: [MESSAGE_ROW],
      activity: [ACTIVITY_ROW],
    });
    const doc = JSON.parse(await collect(service.streamJson('ws-1')));
    expect(doc.format).toBe('declutrmail-export-v1');
    expect(doc.mailboxes).toHaveLength(1);
    const mb = doc.mailboxes[0];
    expect(mb.email).toBe('user@example.com');
    expect(mb.senders).toHaveLength(1);
    expect(mb.messages).toHaveLength(1);
    expect(mb.activity).toHaveLength(1);
  });

  it('exports EXACTLY the allowlisted keys per dataset (privacy pin, D228)', async () => {
    const service = makeService({
      senders: [SENDER_ROW],
      messages: [MESSAGE_ROW],
      activity: [ACTIVITY_ROW],
    });
    const doc = JSON.parse(await collect(service.streamJson('ws-1')));
    const mb = doc.mailboxes[0];
    expect(Object.keys(mb).sort()).toEqual([
      'activity',
      'connectedAt',
      'email',
      'messages',
      'senders',
      'status',
    ]);
    expect(Object.keys(mb.messages[0]).sort()).toEqual([
      'gmailPreview',
      'labels',
      'receivedAt',
      'senderEmail',
      'senderName',
      'subject',
      'unread',
    ]);
    expect(Object.keys(mb.senders[0]).sort()).toEqual([
      'domain',
      'email',
      'firstSeenAt',
      'gmailCategory',
      'isProtected',
      'isVip',
      'lastSeenAt',
      'name',
      'policyType',
      'snoozedUntil',
      'totalReceived',
    ]);
    expect(Object.keys(mb.activity[0]).sort()).toEqual([
      'action',
      'affectedCount',
      'occurredAt',
      'senderEmail',
      'source',
    ]);
  });

  it('stays valid JSON with zero mailboxes and with empty datasets', async () => {
    const empty = JSON.parse(await collect(makeService({ mailboxes: [] }).streamJson('ws-1')));
    expect(empty.mailboxes).toEqual([]);

    const noData = JSON.parse(await collect(makeService({}).streamJson('ws-1')));
    expect(noData.mailboxes[0].senders).toEqual([]);
    expect(noData.mailboxes[0].messages).toEqual([]);
    expect(noData.mailboxes[0].activity).toEqual([]);
  });

  it('comma-joins correctly across batch boundaries', async () => {
    const rows = Array.from({ length: DataExportService.BATCH_SIZE + 5 }, (_, i) => ({
      ...MESSAGE_ROW,
      id: `m-${String(i).padStart(6, '0')}`,
    }));
    const service = makeService({ messages: rows });
    const doc = JSON.parse(await collect(service.streamJson('ws-1')));
    expect(doc.mailboxes[0].messages).toHaveLength(DataExportService.BATCH_SIZE + 5);
  });
});

describe('DataExportService.streamCsv', () => {
  it('emits a header plus one quoted row per message', async () => {
    const service = makeService({ messages: [MESSAGE_ROW] });
    const csv = await collect(service.streamCsv('ws-1'));
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(
      'mailbox_email,sender_email,sender_name,subject,gmail_preview,received_at,labels,unread',
    );
    expect(lines).toHaveLength(2);
    // The quoted subject keeps its comma + escaped quotes.
    expect(lines[1]).toContain('"Hello, ""world"""');
    expect(lines[1]).toContain('unread');
  });

  it('emits only the header when there are no messages', async () => {
    const service = makeService({ messages: [] });
    const csv = await collect(service.streamCsv('ws-1'));
    expect(csv.trimEnd().split('\n')).toHaveLength(1);
  });
});

describe('csvField', () => {
  it('passes plain values through unquoted', () => {
    expect(csvField('plain')).toBe('plain');
  });

  it('quotes commas, quotes, and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes spreadsheet formula-injection triggers (attacker-controlled metadata)', () => {
    // A leading =, +, -, @, tab, or CR is prefixed with a single quote
    // so Excel/Sheets/LibreOffice treat the cell as text, not a formula.
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-2')).toBe("'-2");
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('\tlead-tab')).toBe("'\tlead-tab");
    // A trigger char that is NOT first stays untouched (plain value).
    expect(csvField('a=b')).toBe('a=b');
  });
});
