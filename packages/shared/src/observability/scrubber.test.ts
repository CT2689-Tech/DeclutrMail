import { describe, expect, it } from 'vitest';

import {
  __testing,
  scrubObject,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTelemetryPayload,
} from './scrubber.js';

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

describe('scrubSentryEvent (deny-by-default browser wire policy)', () => {
  const LEAK = 'LEAK-MARKER-private.user@example.com';
  const EVENT_ID = '0123456789abcdef0123456789abcdef';
  const DEBUG_ID = '01234567-89ab-cdef-0123-456789abcdef';

  it('retains diagnostic structure while removing every user-controlled event surface', () => {
    const event = {
      event_id: EVENT_ID,
      timestamp: 1_752_000_000.25,
      start_timestamp: 1,
      level: 'error',
      release: 'web@abc123',
      environment: 'production',
      message: LEAK,
      logentry: { message: LEAK, params: [LEAK] },
      logger: LEAK,
      server_name: LEAK,
      platform: LEAK,
      transaction: LEAK,
      modules: { [LEAK]: LEAK },
      sdk: { name: LEAK },
      user: { id: LEAK, email: LEAK },
      request: {
        url: `https://example.com/?email=${LEAK}`,
        headers: { Authorization: LEAK },
        data: LEAK,
      },
      contexts: { browser: { name: LEAK }, arbitrary: { secret: LEAK } },
      fingerprint: [LEAK],
      spans: [{ description: LEAK, data: { secret: LEAK } }],
      measurements: { private: { value: 1 } },
      extra: { digest: 'abcdef1234567890', secret: LEAK, body: LEAK },
      tags: {
        surface: 'senders',
        reason: 'fetch_failed',
        boundary: 'senders-detail',
        workspace_id: LEAK,
      },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: LEAK,
            module: 'app.feature',
            thread_id: LEAK,
            mechanism: {
              type: 'auto.browser.global_handlers.onerror',
              handled: false,
              synthetic: true,
              is_exception_group: false,
              exception_id: 2,
              parent_id: 1,
              source: LEAK,
              data: { target: LEAK },
            },
            stacktrace: {
              frames_omitted: [0, 2],
              frames: [
                {
                  filename: `https://${LEAK}:${LEAK}@example.com/_next/static/chunks/app/${LEAK}/page-fa91c3129743905c.js?token=${LEAK}#${LEAK}`,
                  abs_path: `//${LEAK}:${LEAK}@cdn.example.com/_next/static/chunks/reset/${LEAK}/page-fa91c3129743905c.js?token=${LEAK}`,
                  function: 'loadInbox',
                  module: 'webpack.chunk',
                  lineno: 42,
                  colno: 7,
                  in_app: true,
                  debug_id: DEBUG_ID,
                  vars: { email: LEAK },
                  context_line: LEAK,
                  pre_context: [LEAK],
                  post_context: [LEAK],
                  module_metadata: { secret: LEAK },
                },
              ],
            },
          },
        ],
      },
      debug_meta: {
        images: [
          {
            type: 'sourcemap',
            debug_id: DEBUG_ID,
            code_file: `https://example.com/_next/static/chunks/private/${LEAK}/page-fa91c3129743905c.js?token=${LEAK}`,
          },
        ],
      },
      breadcrumbs: [
        { category: 'console', message: LEAK, data: { arguments: [LEAK] } },
        {
          category: 'declutrmail.action',
          message: LEAK,
          level: 'info',
          data: {
            verb: 'archive',
            sender_count: 3,
            sender_id: LEAK,
            url: `https://example.com/${LEAK}`,
          },
        },
      ],
    };

    const out = scrubSentryEvent(event);

    expect(out).toEqual({
      event_id: EVENT_ID,
      timestamp: 1_752_000_000.25,
      level: 'error',
      release: 'web@abc123',
      environment: 'production',
      exception: {
        values: [
          {
            type: 'TypeError',
            mechanism: {
              type: 'auto.browser.global_handlers.onerror',
              handled: false,
              synthetic: true,
              is_exception_group: false,
              exception_id: 2,
              parent_id: 1,
            },
            stacktrace: {
              frames: [
                {
                  filename: 'app:///_next/static/chunks/fa91c3129743905c.js',
                  abs_path: 'app:///_next/static/chunks/fa91c3129743905c.js',
                  lineno: 42,
                  colno: 7,
                  in_app: true,
                  debug_id: DEBUG_ID,
                },
              ],
            },
          },
        ],
      },
      tags: {
        surface: 'senders',
        reason: 'fetch_failed',
        boundary: 'senders-detail',
      },
      extra: { digest: 'abcdef1234567890' },
      debug_meta: {
        images: [
          {
            type: 'sourcemap',
            debug_id: DEBUG_ID,
            code_file: 'app:///_next/static/chunks/fa91c3129743905c.js',
          },
        ],
      },
      breadcrumbs: [
        {
          category: 'declutrmail.action',
          message: 'declutrmail.action',
          level: 'info',
          data: { verb: 'archive', sender_count: 3 },
        },
      ],
    });
    expect(JSON.stringify(out)).not.toContain(LEAK);
  });

  it('retains only syntactically valid identities, tags, levels, and digests', () => {
    expect(
      scrubSentryEvent({
        event_id: 'not-an-event-id',
        timestamp: Number.POSITIVE_INFINITY,
        level: 'private',
        environment: 'prod/private',
        tags: {
          surface: 'senders/private',
          reason: 'a'.repeat(65),
          boundary: 123,
        },
        extra: { digest: 'private@email.example', other: 'private' },
      }),
    ).toEqual({});

    expect(scrubSentryEvent({ extra: { digest: '1234567' } })).toEqual({
      extra: { digest: '1234567' },
    });
    expect(scrubSentryEvent({ extra: { digest: '7f2a9100deadbeef' } })).toEqual({
      extra: { digest: '7f2a9100deadbeef' },
    });
  });

  it('drops user-controlled identifiers and canonicalizes only hashed Next.js assets', () => {
    const exceptionLeak = 'SECRET_TOKEN_ABC';
    const identifierLeak = 'private_user_token';
    const capabilityLeak = '0123456789abcdef0123456789abcdef';
    const out = scrubSentryEvent({
      exception: {
        values: [
          {
            type: exceptionLeak,
            module: identifierLeak,
            mechanism: { type: identifierLeak, handled: false },
            stacktrace: {
              frames: [
                {
                  filename: `https://cdn.example.com/_next/static/chunks/reset/${capabilityLeak}/${exceptionLeak}-deadbeefcafebabe.js?email=private@example.com`,
                  abs_path: `/reset/${capabilityLeak}/chunk.js`,
                  function: identifierLeak,
                  module: identifierLeak,
                  vars: { private: true },
                  context_line: 'private',
                  lineno: -1,
                  colno: Number.NaN,
                  debug_id: 'too-short',
                },
              ],
            },
          },
        ],
      },
    });

    expect(out).toEqual({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: 'app:///_next/static/chunks/deadbeefcafebabe.js',
                },
              ],
            },
          },
        ],
      },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(exceptionLeak);
    expect(serialized).not.toContain(identifierLeak);
    expect(serialized).not.toContain(capabilityLeak);
    expect(serialized).not.toContain('private@example.com');
  });

  it('drops non-error envelope types instead of implying beforeSend coverage', () => {
    for (const type of ['transaction', 'profile', 'replay_event', 'feedback']) {
      expect(scrubSentryEvent({ type, message: LEAK })).toBeNull();
    }
  });

  it('fails closed when an event accessor throws', () => {
    const event = {} as Record<string, unknown>;
    Object.defineProperty(event, 'event_id', {
      get() {
        throw new Error('private getter');
      },
    });
    expect(scrubSentryEvent(event)).toBeNull();
  });
});

describe('scrubSentryBreadcrumb (manual-only wire policy)', () => {
  it('drops automatic and unmarked breadcrumbs', () => {
    expect(scrubSentryBreadcrumb({ category: 'console', message: 'private' })).toBeNull();
    expect(scrubSentryBreadcrumb({ category: 'navigation', message: '/private/url' })).toBeNull();
    expect(
      scrubSentryBreadcrumb({ category: 'declutrmail.future-category', message: 'private' }),
    ).toBeNull();
  });

  it('replaces the message and retains only allowlisted, validated scalar data', () => {
    const LEAK = 'BREADCRUMB-LEAK-private.user@example.com';
    const out = scrubSentryBreadcrumb({
      type: 'http',
      event_id: LEAK,
      category: 'declutrmail.action',
      message: `clicked ${LEAK}`,
      level: 'warning',
      timestamp: 123.5,
      data: {
        verb: 'archive',
        sender_count: 2,
        message_count: 5,
        token_count: 1,
        has_secondary: false,
        older_than_days: null,
        sender_id: LEAK,
        mailbox_id: LEAK,
        url: `https://example.com/?email=${LEAK}`,
        headers: { Authorization: LEAK },
      },
    });

    expect(out).toEqual({
      category: 'declutrmail.action',
      message: 'declutrmail.action',
      level: 'warning',
      timestamp: 123.5,
      data: {
        verb: 'archive',
        sender_count: 2,
        message_count: 5,
        token_count: 1,
        has_secondary: false,
        older_than_days: null,
      },
    });
    expect(JSON.stringify(out)).not.toContain(LEAK);
  });

  it('drops unknown keys and invalid values without dropping the manual crumb', () => {
    expect(
      scrubSentryBreadcrumb({
        category: 'declutrmail.sync',
        message: 'private',
        level: 'private',
        timestamp: Number.NaN,
        data: {
          verb: 'email-private-user',
          sender_count: -1,
          message_count: '5',
          has_secondary: 'true',
          older_than_days: 30.5,
        },
      }),
    ).toEqual({ category: 'declutrmail.sync', message: 'declutrmail.sync' });
  });

  it('fails closed when a breadcrumb accessor throws', () => {
    const breadcrumb = {} as Record<string, unknown>;
    Object.defineProperty(breadcrumb, 'category', {
      get() {
        throw new Error('private getter');
      },
    });
    expect(scrubSentryBreadcrumb(breadcrumb)).toBeNull();
  });
});
