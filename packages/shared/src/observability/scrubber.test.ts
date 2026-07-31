import { describe, expect, it } from 'vitest';

import {
  __testing,
  scrubObject,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTelemetryPayload,
  scrubUrlQueries,
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

describe('scrubSentryEvent — server profile (D158)', () => {
  const serverEvent = {
    event_id: 'a'.repeat(32),
    level: 'error',
    environment: 'production',
    exception: {
      values: [
        {
          type: 'PermanentError',
          // The exact leak the profile exists to stop: a subject line
          // interpolated into Error.message.
          value: 'Refusing to send: subject was "Re: your invoice from Acme"',
          stacktrace: { frames: [{ filename: 'app:///worker.js', lineno: 12, colno: 3 }] },
        },
      ],
    },
    tags: {
      worker: 'unsub-execution',
      policy: 'mail-mutation',
      job_id: 'unsub__mb-1__42',
      mailbox_account_id: '576df4e8-795b-4722-9aac-4ed22eafae99',
      kind: 'dead_letter.scheduler_failed',
      smuggled: 'user@example.com wrote about...',
    },
  };

  it('omits Error.message while keeping the server error type + stack', () => {
    const out = scrubSentryEvent(serverEvent, 'server');
    const exc = (out?.exception as { values: Record<string, unknown>[] }).values[0]!;
    expect(exc.type).toBe('PermanentError');
    expect(exc.value).toBeUndefined();
    expect(exc.stacktrace).toBeDefined();
    expect(JSON.stringify(out)).not.toContain('invoice');
  });

  it('keeps the triage tags and drops everything else', () => {
    const out = scrubSentryEvent(serverEvent, 'server');
    expect(out?.tags).toEqual({
      worker: 'unsub-execution',
      policy: 'mail-mutation',
      job_id: 'unsub__mb-1__42',
      mailbox_account_id: '576df4e8-795b-4722-9aac-4ed22eafae99',
      kind: 'dead_letter.scheduler_failed',
    });
  });

  it('the browser profile does NOT gain the server tags or types', () => {
    const out = scrubSentryEvent(serverEvent);
    expect(out?.tags).toBeUndefined();
    const exc = (out?.exception as { values: Record<string, unknown>[] } | undefined)?.values?.[0];
    // PermanentError is not a browser-approved type; the frame survives.
    expect(exc?.type).toBeUndefined();
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

/**
 * URL query scrubbing (Codex stop-review, 2026-07-31).
 *
 * `scrubObject` removes banned KEYS and never inspects a string VALUE,
 * so PostHog's `$current_url` carried the whole address bar. Two live
 * routes put Gmail-derived identity in the query —
 * `/activity?sender_q=<address>` (sender detail → Activity) and
 * `/senders?q=<free text>` — so every automatic pageview after such a
 * navigation shipped a sender's email to PostHog, while the cookie
 * banner promises it "receives product-usage events, never Gmail
 * message data".
 */
describe('scrubUrlQueries', () => {
  it('strips a sender address from the real leaking URL', () => {
    expect(
      scrubUrlQueries({
        $current_url: 'https://declutrmail.com/activity?sender_q=someone%40example.com',
      }),
    ).toEqual({ $current_url: 'https://declutrmail.com/activity' });
  });

  it('strips the senders free-text query too', () => {
    const out = scrubUrlQueries({ $current_url: 'https://declutrmail.com/senders?q=acme.com' });
    expect(out.$current_url).toBe('https://declutrmail.com/senders');
  });

  it('keeps campaign attribution and drops everything beside it', () => {
    expect(
      scrubUrlQueries({
        $current_url: 'https://declutrmail.com/?utm_source=x&sender_q=a%40b.com&utm_medium=email',
      }),
    ).toEqual({ $current_url: 'https://declutrmail.com/?utm_source=x&utm_medium=email' });
  });

  it('reaches URL-shaped values under ANY key, at any depth', () => {
    // The SDK owns these key names and can add more without asking us,
    // which is why this walks values rather than an allowlist of keys.
    expect(
      scrubUrlQueries({
        $referrer: 'https://declutrmail.com/senders?q=a%40b.com',
        nested: { $initial_current_url: 'https://declutrmail.com/x?token=abc' },
        list: ['https://declutrmail.com/y?sender_q=c%40d.com'],
      }),
    ).toEqual({
      $referrer: 'https://declutrmail.com/senders',
      nested: { $initial_current_url: 'https://declutrmail.com/x' },
      list: ['https://declutrmail.com/y'],
    });
  });

  // The query was only ONE way through. These lock the other four —
  // three of which shipped in the first version of this scrubber, which
  // subtracted the part I had thought of instead of rebuilding from the
  // parts that are safe (Codex stop-review, 2026-07-31).
  it('strips the FRAGMENT, including when there is no query at all', () => {
    // A fragment-only URL skipped the function entirely: the fast path
    // keyed on `?`, and the address bar carries the hash too.
    expect(
      scrubUrlQueries({
        a: 'https://declutrmail.com/activity#sender_q=someone@example.com',
        b: 'https://declutrmail.com/activity?x=1#token=someone@example.com',
      }),
    ).toEqual({
      a: 'https://declutrmail.com/activity',
      b: 'https://declutrmail.com/activity',
    });
  });

  it('drops an allowed param whose VALUE carries identity', () => {
    // A name allowlist constrains who may speak, not what they may say.
    expect(
      scrubUrlQueries({ u: 'https://declutrmail.com/?utm_content=someone@example.com' }),
    ).toEqual({ u: 'https://declutrmail.com/' });
  });

  it('drops `ref` entirely — not a param any analytics tool reads', () => {
    expect(scrubUrlQueries({ u: 'https://declutrmail.com/?ref=someone@example.com' })).toEqual({
      u: 'https://declutrmail.com/',
    });
  });

  it('keeps ordinary campaign values, so attribution still works', () => {
    expect(
      scrubUrlQueries({
        u: 'https://declutrmail.com/?utm_source=twitter&utm_campaign=launch-2026&gclid=Cj0KCQ_abc123',
      }),
    ).toEqual({
      u: 'https://declutrmail.com/?utm_source=twitter&utm_campaign=launch-2026&gclid=Cj0KCQ_abc123',
    });
  });

  it('drops `user:pass@host` userinfo', () => {
    // An address parked in the userinfo position survives a query strip.
    expect(scrubUrlQueries({ u: 'https://someone%40example.com:x@declutrmail.com/a?b=1' })).toEqual(
      { u: 'https://declutrmail.com/a' },
    );
  });

  it('leaves non-URL strings, query-less URLs and non-http schemes untouched', () => {
    const input = {
      verb: 'archive?',
      plain: 'https://declutrmail.com/senders',
      mailto: 'mailto:a@b.com?subject=hi',
      notAUrl: 'https://?',
      count: 3,
      flag: true,
      nothing: null,
    };
    expect(scrubUrlQueries(input)).toEqual(input);
  });

  // A REVISIT MUST RETURN THE SCRUBBED COPY, not the input.
  //
  // These assert one level DOWN on purpose. The first version of the
  // cycle test checked only the top-level `$current_url` and passed
  // while `out.self.$current_url` still carried the address — a test
  // shaped so it could not observe the bug it was named for (Codex
  // stop-review, 2026-07-31).
  it('a cycle is scrubbed at every level, and stays a cycle', () => {
    const cyclic: Record<string, unknown> = {
      $current_url: 'https://declutrmail.com/a?sender_q=x%40y.com',
    };
    cyclic.self = cyclic;
    const out = scrubUrlQueries(cyclic);
    expect(out.$current_url).toBe('https://declutrmail.com/a');
    expect((out.self as Record<string, unknown>).$current_url).toBe('https://declutrmail.com/a');
    // The scrubbed copy points at ITSELF — never back at the raw input.
    expect(out.self).toBe(out);
    expect(out.self).not.toBe(cyclic);
  });

  it('a SHARED reference is scrubbed on every appearance', () => {
    // The dangerous half: a cycle dies in the SDK's own JSON.stringify,
    // but a shared reference serializes perfectly and used to come back
    // raw on its second appearance.
    const shared = { $current_url: 'https://declutrmail.com/a?sender_q=x%40y.com' };
    const out = scrubUrlQueries({ one: shared, two: shared });
    expect(out.one.$current_url).toBe('https://declutrmail.com/a');
    expect(out.two.$current_url).toBe('https://declutrmail.com/a');
    expect(out.one).toBe(out.two);
  });

  it('runs as part of the wire-boundary hook, not only on its own', () => {
    // `scrubTelemetryPayload` IS PostHog's `sanitize_properties`. If the
    // URL scrub is not wired into it, the leak stands however good the
    // helper is.
    expect(
      scrubTelemetryPayload({
        $current_url: 'https://declutrmail.com/activity?sender_q=someone%40example.com',
        body: 'should also be redacted',
      }),
    ).toEqual({ $current_url: 'https://declutrmail.com/activity', body: '[redacted]' });
  });
});

/**
 * The same repeat-visit bypass lived in `scrubObject` from the day it
 * was written, where it is a D7 failure rather than a URL one: the
 * second appearance of a shared object returned the RAW Gmail payload.
 */
describe('scrubObject — repeat visits', () => {
  it('redacts a banned key on every appearance of a shared object', () => {
    const message = { body: 'FULL GMAIL BODY', id: 'msg_1' };
    const out = scrubObject({ first: message, second: message });
    expect(out.first.body).toBe('[redacted]');
    expect(out.second.body).toBe('[redacted]');
    expect(out.first).toBe(out.second);
  });

  it('redacts through a cycle', () => {
    const node: Record<string, unknown> = { body: 'FULL GMAIL BODY' };
    node.self = node;
    const out = scrubObject(node);
    expect(out.body).toBe('[redacted]');
    expect((out.self as Record<string, unknown>).body).toBe('[redacted]');
    expect(out.self).toBe(out);
  });

  it('redacts a shared object inside an array', () => {
    const message = { snippet: 'preview text' };
    const out = scrubObject({ items: [message, message] });
    expect(out.items[0]?.snippet).toBe('[redacted]');
    expect(out.items[1]?.snippet).toBe('[redacted]');
  });
});
