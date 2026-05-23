import { describe, expect, it } from 'vitest';

import { __testing, scrubObject, scrubTelemetryPayload } from './scrubber.js';

/**
 * Privacy scrubber unit tests (D7, D228, D159).
 *
 * The scrubber is the SECOND line of defense. The FIRST is "only pass
 * scalars into telemetry calls in the first place" — but these tests
 * lock the guarantee that even if a future agent forgets and spreads a
 * full Gmail message into an event payload, the wire never sees body
 * content, attachments, or non-allowlisted headers.
 *
 * Each test injects the banned field at a different layer (top level,
 * nested, deeply nested, inside arrays, inside Sentry-shaped event)
 * and asserts the output contains zero scope-banned values.
 */

const REDACTED = __testing.REDACTED;

// A realistic Gmail message-ish payload — exactly the kind of thing
// that could leak into telemetry if a caller passes the wrong variable.
function fullGmailMessage() {
  return {
    id: 'msg_internal_uuid_123', // OK — internal id
    threadId: 'thread_internal_uuid_456', // OK — internal id
    snippet: 'Hey Chintan, here is the wire transfer detail...', // BANNED
    body: '<html><body>Full message body should never leak</body></html>', // BANNED
    htmlBody: '<html>another path</html>', // BANNED
    textBody: 'Plain text version of the body', // BANNED
    payload: {
      // BANNED top key — even nested children get scrubbed via redaction
      mimeType: 'multipart/mixed',
      body: { data: 'base64encodedbody==', size: 1234 },
      parts: [
        { mimeType: 'text/html', body: { data: 'AAA' } },
        { mimeType: 'text/plain', body: { data: 'BBB' } },
      ],
    },
    attachments: [{ id: 'att1', filename: 'invoice.pdf', size: 99 }],
    attachmentIds: ['att1'],
    mimeType: 'multipart/mixed',
    mimeContent: 'raw mime here',
    raw: 'base64 raw rfc2822',
    headers: {
      Subject: 'Q3 invoice',
      From: 'billing@example.com',
      To: 'me@example.com',
      'Message-ID': '<abc@example.com>',
      'X-Originating-IP': '192.0.2.1',
      'X-Custom-Tracker': 'tracker-id-7',
      Received: 'from mx.example.com',
    },
  };
}

describe('scrubObject', () => {
  it('redacts top-level banned keys (body / htmlBody / textBody / snippet)', () => {
    const out = scrubObject(fullGmailMessage());
    expect(out.body).toBe(REDACTED);
    expect(out.htmlBody).toBe(REDACTED);
    expect(out.textBody).toBe(REDACTED);
    expect(out.snippet).toBe(REDACTED);
  });

  it('redacts the entire Gmail `payload` envelope (which carries body parts)', () => {
    const out = scrubObject(fullGmailMessage());
    expect(out.payload).toBe(REDACTED);
  });

  it('redacts any attachment* key', () => {
    const out = scrubObject(fullGmailMessage());
    expect(out.attachments).toBe(REDACTED);
    expect(out.attachmentIds).toBe(REDACTED);
  });

  it('redacts mime* and raw keys', () => {
    const out = scrubObject(fullGmailMessage());
    expect(out.mimeType).toBe(REDACTED);
    expect(out.mimeContent).toBe(REDACTED);
    expect(out.raw).toBe(REDACTED);
  });

  it('preserves internal identifiers (id, threadId) — they are not PII', () => {
    const out = scrubObject(fullGmailMessage());
    expect(out.id).toBe('msg_internal_uuid_123');
    expect(out.threadId).toBe('thread_internal_uuid_456');
  });

  it('strips non-allowlisted headers but keeps allowlisted ones', () => {
    const out = scrubObject(fullGmailMessage()) as {
      headers: Record<string, string>;
    };
    // Allowlist: subject, from, to, cc, date, list-unsubscribe, list-unsubscribe-post
    expect(out.headers.Subject).toBe('Q3 invoice');
    expect(out.headers.From).toBe('billing@example.com');
    expect(out.headers.To).toBe('me@example.com');
    // Message-ID is NOT in the telemetry allowlist (D7) — must be stripped
    expect(out.headers['Message-ID']).toBeUndefined();
    // Non-allowlist — stripped
    expect(out.headers['X-Originating-IP']).toBeUndefined();
    expect(out.headers['X-Custom-Tracker']).toBeUndefined();
    expect(out.headers.Received).toBeUndefined();
  });

  it('strips non-allowlisted headers in Gmail-array shape too', () => {
    const out = scrubObject({
      headers: [
        { name: 'Subject', value: 'hi' },
        { name: 'From', value: 'a@b.com' },
        { name: 'X-Sketchy', value: 'leak me' },
        { name: 'List-Unsubscribe', value: '<https://u>' },
      ],
    }) as { headers: Array<{ name: string; value: string }> };
    const names = out.headers.map((h) => h.name);
    expect(names).toEqual(['Subject', 'From', 'List-Unsubscribe']);
  });

  it('scrubs banned keys nested inside arbitrary objects (Sentry extras shape)', () => {
    const sentryExtras = {
      extra: {
        msg: fullGmailMessage(),
      },
      contexts: {
        gmail: {
          response: { body: 'leaked through context', snippet: 'no!' },
        },
      },
    };
    const out = scrubObject(sentryExtras);
    expect(out.extra.msg.body).toBe(REDACTED);
    expect(out.extra.msg.snippet).toBe(REDACTED);
    expect(out.extra.msg.payload).toBe(REDACTED);
    expect(out.contexts.gmail.response.body).toBe(REDACTED);
    expect(out.contexts.gmail.response.snippet).toBe(REDACTED);
  });

  it('scrubs banned keys nested inside arrays', () => {
    const out = scrubObject({
      breadcrumbs: [
        { category: 'gmail', message: 'fetched', data: { snippet: 'preview' } },
        { category: 'app', message: 'ok', data: { body: 'inline body' } },
      ],
    }) as { breadcrumbs: Array<{ data: Record<string, unknown> }> };
    expect(out.breadcrumbs[0]!.data.snippet).toBe(REDACTED);
    expect(out.breadcrumbs[1]!.data.body).toBe(REDACTED);
  });

  it('survives deeply nested injection (>5 levels)', () => {
    const deep = {
      a: { b: { c: { d: { e: { snippet: 'deeply leaked', body: 'and here' } } } } },
    };
    const out = scrubObject(deep);
    expect(out.a.b.c.d.e.snippet).toBe(REDACTED);
    expect(out.a.b.c.d.e.body).toBe(REDACTED);
  });

  it('handles cycles without infinite recursion', () => {
    const obj: Record<string, unknown> = { snippet: 'cycle', other: 'ok' };
    obj.self = obj;
    const out = scrubObject(obj);
    expect(out.snippet).toBe(REDACTED);
    expect(out.other).toBe('ok');
  });

  it('returns scalars and null unchanged', () => {
    expect(scrubObject('hello')).toBe('hello');
    expect(scrubObject(42)).toBe(42);
    expect(scrubObject(null)).toBe(null);
    expect(scrubObject(undefined)).toBe(undefined);
  });
});

describe('scrubTelemetryPayload (SDK beforeSend hook)', () => {
  it('returns null for null/undefined input (drop the event)', () => {
    expect(scrubTelemetryPayload(null)).toBe(null);
    expect(scrubTelemetryPayload(undefined)).toBe(null);
  });

  it('mirrors scrubObject for valid Sentry-shaped event', () => {
    const sentryEvent = {
      event_id: 'evt_1',
      level: 'error',
      message: 'Gmail fetch failed',
      extra: { msg: fullGmailMessage() },
      breadcrumbs: [{ category: 'gmail', message: 'fetch', data: { body: 'do not leak' } }],
    };
    const out = scrubTelemetryPayload(sentryEvent)!;
    expect(out.event_id).toBe('evt_1');
    expect(out.level).toBe('error');
    // typed cast for assertions
    const extra = out.extra as unknown as {
      msg: { body: string; snippet: string; payload: string };
    };
    expect(extra.msg.body).toBe(REDACTED);
    expect(extra.msg.snippet).toBe(REDACTED);
    expect(extra.msg.payload).toBe(REDACTED);
    const breadcrumbs = out.breadcrumbs as Array<{ data: { body: string } }>;
    expect(breadcrumbs[0]!.data.body).toBe(REDACTED);
  });
});

describe('cross-cutting privacy assertion (the headline guarantee)', () => {
  /**
   * Serialize the scrubbed output and assert that NONE of the
   * leak strings appear. This is the "would a privacy-paranoid
   * reviewer see body content on the wire?" test.
   */
  it('serialized telemetry payload contains zero banned values', () => {
    const leakBody = 'WIRE-TRANSFER-DETAILS-12345';
    const leakSnippet = 'SNIPPET-LEAK-MARKER-67890';
    const leakAttachment = 'ATTACHMENT-CONTENT-LEAK-ABCDE';

    const event = {
      extra: {
        msg: {
          body: leakBody,
          snippet: leakSnippet,
          attachments: [{ data: leakAttachment }],
        },
      },
      breadcrumbs: [
        {
          data: {
            payload: { parts: [{ body: { data: leakBody } }] },
          },
        },
      ],
    };

    const serialized = JSON.stringify(scrubTelemetryPayload(event));
    expect(serialized).not.toContain(leakBody);
    expect(serialized).not.toContain(leakSnippet);
    expect(serialized).not.toContain(leakAttachment);
  });
});
