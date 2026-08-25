import { describe, expect, it } from 'vitest';

import { providerErrorBody } from '../provider-error-body.js';

/**
 * The diagnostic that eleven days of `status=403` did not have.
 *
 * Every assertion here is about a failure path, which is the point: this
 * helper only ever runs when something is already wrong, so it must not
 * be able to make things worse — not by throwing, not by leaking, not by
 * flooding.
 */
describe('providerErrorBody', () => {
  it('returns the provider explanation that a status code cannot carry', async () => {
    const body = JSON.stringify({
      error: {
        type: 'request_error',
        code: 'forbidden',
        detail: 'You do not have permission to perform this request (adjustment.read)',
      },
    });
    const out = await providerErrorBody(new Response(body, { status: 403 }));
    // The literal sentence that would have named the fix on day one.
    expect(out).toContain('adjustment.read');
    expect(out).toContain('forbidden');
  });

  // `GET /customers?email=<address>` is a real call (paddle.adapter.ts
  // searchCustomers), so a 4xx there can echo a customer's own address
  // back at us. Logging bodies without this would have moved customer
  // emails into Cloud Logging as a side effect of a diagnostics fix.
  it('redacts email addresses the provider echoes back', async () => {
    const body = JSON.stringify({
      error: { code: 'not_found', detail: 'No customer matching person@example.com was found' },
    });
    const out = await providerErrorBody(new Response(body, { status: 404 }));
    expect(out).not.toContain('person@example.com');
    expect(out).toContain('[email]');
    // The diagnosable half survives the redaction.
    expect(out).toContain('not_found');
  });

  it('redacts BEFORE truncating, so the cut cannot leave a half address', async () => {
    // The address is positioned to STRADDLE the 300-char cut: 280 filler
    // + ' contact ' puts it at index 289, so truncate-first would slice
    // it at 300 and leave `someone.lon` — a fragment the pattern can no
    // longer match, and still a real local-part in a log line.
    //
    // Asserting on the full address would be vacuous here: truncation
    // alone removes that, so the test would pass against the unredacted
    // implementation and prove nothing. The FRAGMENT is the assertion
    // that distinguishes the two orderings.
    const filler = 'x'.repeat(280);
    const body = `${filler} contact someone.longname@example.com now`;
    const out = await providerErrorBody(new Response(body, { status: 400 }));
    expect(out).not.toContain('someone.lon');
    expect(out).toContain('[email]');
  });

  it('caps the body so a proxy HTML error page cannot flood the line', async () => {
    const out = await providerErrorBody(new Response('y'.repeat(5_000), { status: 502 }));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never throws — an error path must not acquire a second error', async () => {
    // A body already consumed: `res.text()` rejects. Returning a marker
    // keeps a diagnosable provider failure diagnosable, where a throw
    // here would replace it with an opaque one.
    const res = new Response('{"error":"x"}', { status: 500 });
    await res.text();
    await expect(providerErrorBody(res)).resolves.toBe('<unreadable>');

    // An empty body is a fact worth stating, not a blank in the line.
    await expect(providerErrorBody(new Response('', { status: 503 }))).resolves.toBe('<empty>');
  });
});
