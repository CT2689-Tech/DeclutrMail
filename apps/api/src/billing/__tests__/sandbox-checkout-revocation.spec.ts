import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaddleAdapter, type SandboxCheckoutIdentity } from '../paddle.adapter.js';

const secret = 'fixture-only-secret';
const identity: SandboxCheckoutIdentity = {
  workspaceId: '11111111-2222-4333-8444-555555555555',
  attemptId: '11111111-2222-4333-8444-666666666666',
  priceId: 'pri_01ky067arw41802a6ssessknxh',
};
const id = 'txn_01ky067arw41802a6ssessknxh';
const env = {
  PADDLE_ENV: 'sandbox',
  BILLING_CHECKOUT_REVOCATION_REHEARSAL: 'sandbox',
  PADDLE_API_KEY: 'pdl_sdbx_apikey_' + 'a'.repeat(26) + '_' + 'b'.repeat(22) + '_ccc',
  PADDLE_WEBHOOK_SECRET: secret,
};
function transaction(status = 'draft', extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    subscription_id: null,
    collection_mode: 'automatic',
    origin: 'api',
    items: [{ price: { id: identity.priceId }, quantity: 1 }],
    custom_data: {
      workspace_id: identity.workspaceId,
      sig: createHmac('sha256', secret)
        .update(`paddle:workspace:${identity.workspaceId}`)
        .digest('hex'),
      checkout_attempt_id: identity.attemptId,
      checkout_attempt_sig: createHmac('sha256', secret)
        .update(
          `paddle:sandbox-checkout:${identity.workspaceId}:${identity.attemptId}:${identity.priceId}`,
        )
        .digest('hex'),
    },
    ...extra,
  };
}
const response = (data: unknown, hasMore?: boolean) =>
  new Response(
    JSON.stringify({
      data,
      ...(hasMore === undefined ? {} : { meta: { pagination: { has_more: hasMore } } }),
    }),
  );
afterEach(() => vi.unstubAllGlobals());
describe('ADR-0046 sandbox checkout boundary and payment holds', () => {
  it.each([
    { PADDLE_ENV: 'production' },
    { PADDLE_ENV: undefined },
    { PADDLE_API_KEY: 'pdl_live_apikey_fixture' },
    { BILLING_CHECKOUT_REVOCATION_REHEARSAL: undefined },
    { PADDLE_WEBHOOK_SECRET: undefined },
  ])('refuses unsupported environment before provider I/O %j', async (override) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const adapter = new PaddleAdapter({ ...env, ...override });
    for (const action of [
      () => adapter.prepareSandboxCheckout(identity),
      () => adapter.readSandboxCheckout(identity, id),
      () => adapter.revokeSandboxCheckout(identity, id),
      () => adapter.recoverSandboxCheckout(identity, new Date().toISOString()),
    ])
      await expect(action()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('creates one signed provider artifact; never silently retries a timed-out create', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network error containing private request'));
    vi.stubGlobal('fetch', fetch);
    await expect(new PaddleAdapter(env).prepareSandboxCheckout(identity)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://sandbox-api.paddle.com/transactions');
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toMatchObject({
      collection_mode: 'automatic',
      items: [{ price_id: identity.priceId, quantity: 1 }],
      custom_data: { checkout_attempt_id: identity.attemptId },
    });
  });
  it('requires fresh cancellation readback and keeps payment winning during cancellation held', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(transaction()))
      .mockResolvedValueOnce(response(transaction('canceled')))
      .mockResolvedValueOnce(
        response(transaction('completed', { subscription_id: 'sub_fixture' })),
      );
    vi.stubGlobal('fetch', fetch);
    expect((await new PaddleAdapter(env).revokeSandboxCheckout(identity, id)).hold).toBe('paid');
    expect(fetch.mock.calls.map((c) => c[1].method)).toEqual(['GET', 'PATCH', 'GET']);
  });
  it.each(['paid', 'completed', 'billed', 'past_due', 'unexpected', 'canceled'])(
    'never sends cancellation for %s',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(response(transaction(status)));
      vi.stubGlobal('fetch', fetch);
      await new PaddleAdapter(env).revokeSandboxCheckout(identity, id);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not release on successful PATCH followed by unavailable read', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(transaction()))
      .mockResolvedValueOnce(response(transaction('canceled')))
      .mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('fetch', fetch);
    await expect(new PaddleAdapter(env).revokeSandboxCheckout(identity, id)).rejects.toThrow();
  });
  it.each([
    { custom_data: {} },
    { collection_mode: 'manual' },
    { items: [] },
    { subscription_id: undefined },
    { id: 'txn_unexpected' },
  ])('refuses mismatched/unproven artifact %j', async (extra) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(transaction('draft', extra))));
    await expect(new PaddleAdapter(env).readSandboxCheckout(identity, id)).rejects.toThrow();
  });
  it.each([{ rows: [] }, { rows: [transaction(), transaction()] }, { rows: [transaction()] }])(
    'incomplete recovery never releases an unknown create',
    async ({ rows }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(response(rows, rows.length === 1 ? undefined : false)),
      );
      await expect(
        new PaddleAdapter(env).recoverSandboxCheckout(
          identity,
          new Date(Date.now() - 1000).toISOString(),
        ),
      ).rejects.toThrow();
    },
  );
  it('recovers exactly one signed transaction after simulated crash before binding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([transaction()], false)));
    expect(
      await new PaddleAdapter(env).recoverSandboxCheckout(
        identity,
        new Date(Date.now() - 1000).toISOString(),
      ),
    ).toMatchObject({ transactionId: id, hold: 'unpaid' });
  });
});
