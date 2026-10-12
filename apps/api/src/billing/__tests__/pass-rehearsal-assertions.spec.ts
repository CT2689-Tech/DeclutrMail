import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discountMatchesPercent,
  discountPriceIds,
  paddleProviderCode,
  passTransactionCreateBody,
  rehearsalPayUrl,
  renderSandboxPayPage,
  renewalIsFullPrice,
  SANDBOX_API_ORIGIN,
  withinWindow,
} from '../../../scripts/helpers/pass-rehearsal-assertions.js';
import {
  isCardPayButton,
  SANDBOX_CARD_SELECTORS,
  sandboxCheckoutEvent,
  sandboxFieldToken,
} from '../../../scripts/helpers/sandbox-checkout-pay.js';

describe('Backlog Pass sandbox rehearsal checks', () => {
  it('accepts a thirty percent discount and a full-price renewal', () => {
    expect(discountMatchesPercent('5900', '1770', 30)).toBe(true);
    expect(discountMatchesPercent('5900', '0', 30)).toBe(false);
    expect(discountMatchesPercent('5900', '1771', 30)).toBe(false);
    expect(renewalIsFullPrice('5900', '0', '5900')).toBe(true);
    expect(renewalIsFullPrice('5900', '1770', '5900')).toBe(false);
    expect(renewalIsFullPrice('4130', '0', '5900')).toBe(false);
  });

  it('accepts only the two rehearsed price ids', () => {
    const prices = ['pri_annual', 'pri_pass'];
    expect(discountPriceIds(['pri_pass', 'pri_annual'], prices)).toBe(true);
    expect(discountPriceIds(['pro_plus', 'pri_annual', 'pri_pass'], prices)).toBe(true);
    expect(discountPriceIds(['pri_annual', 'pri_pass', 'pri_other'], prices)).toBe(false);
    expect(discountPriceIds(['pro_plus'], prices)).toBe(false);
  });

  it('keeps a thirty day grant inside the checkout slack', () => {
    const day = 30 * 24 * 60 * 60 * 1000;
    const expires = new Date(Date.now() + day - 60_000);
    expect(withinWindow(expires, Date.now() + day, 15 * 60 * 1000)).toBe(true);
    expect(
      withinWindow(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), Date.now() + day, 60_000),
    ).toBe(false);
  });

  it('opens the transaction on our page without checkout.url', () => {
    const host = 'https://fixture-host.trycloudflare.com';
    const txn = 'txn_0123456789abcdefghijklmnop';
    const body = passTransactionCreateBody({
      priceId: 'pri_01m4phkr8yhydb76dz11b74br8',
      workspaceId: 'ws',
      customerId: 'ctm_0123456789abcdefghijklmnop',
      addressId: 'add_0123456789abcdefghijklmnop',
      signature: 'sig',
    });
    expect(body.collection_mode).toBe('automatic');
    expect(body).not.toHaveProperty('checkout');
    expect(body).not.toHaveProperty('billing_cycle');
    expect(body.items).toEqual([{ price_id: 'pri_01m4phkr8yhydb76dz11b74br8', quantity: 1 }]);
    expect(body).not.toHaveProperty('discount_id');
    expect(
      passTransactionCreateBody({
        priceId: 'pri_01m4phk06hdmmq5cw5b8aa5r2y',
        workspaceId: 'ws',
        customerId: 'ctm_0123456789abcdefghijklmnop',
        addressId: 'add_0123456789abcdefghijklmnop',
        signature: 'sig',
        discountId: 'dsc_01m4phpp04scdes9ghqn3qps77',
      }).discount_id,
    ).toBe('dsc_01m4phpp04scdes9ghqn3qps77');
    expect(rehearsalPayUrl(host, txn)).toBe(`${host}/pay?_ptxn=${txn}`);
    expect(() => rehearsalPayUrl('https://declutrmail.com', txn)).toThrow(
      'Checkout page was not the rehearsal host',
    );
    expect(() => rehearsalPayUrl(host, 'txn_short')).toThrow(
      'Checkout page was not the rehearsal host',
    );
    const page = renderSandboxPayPage('test_sandboxtoken', txn);
    expect(page).toContain('https://cdn.paddle.com/paddle/v2/paddle.js');
    expect(page).toContain('Paddle.Environment.set("sandbox")');
    expect(page).toContain('"test_sandboxtoken"');
    expect(page).toContain(`Paddle.Checkout.open({ transactionId: "${txn}" })`);
    expect(page).toContain('eventCallback: remember');
    expect(page).toContain('typeof event.code === "string"');
    expect(page).toContain('window.__paddleEvents');
    expect(page).not.toContain('checkout.url');
    expect(page).not.toContain('4242');
    expect(page).not.toContain('api.paddle.com');
    expect(page).not.toContain('production');
    expect(() => renderSandboxPayPage('live_token', txn)).toThrow('Sandbox client token required');
    expect(() => renderSandboxPayPage('test_sandboxtoken', 'not-a-transaction')).toThrow(
      'Sandbox transaction required',
    );
    expect(
      paddleProviderCode({
        error: {
          code: 'transaction_checkout_url_domain_is_not_approved',
          detail: 'https://secret.example/key',
        },
      }),
    ).toBe('transaction_checkout_url_domain_is_not_approved');
    expect(paddleProviderCode({ error: { code: 'https://secret.example' } })).toBeNull();
    expect(paddleProviderCode({ error: { detail: 'pdl_sdbx_apikey_secret' } })).toBeNull();
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../scripts/billing-pass-sandbox-rehearsal.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/checkout:\s*\{\s*url/);
    expect(source).toContain('rehearsal.provider_code=');
    expect(SANDBOX_CARD_SELECTORS).toEqual(
      expect.arrayContaining([
        '[data-testid="cardNumberInput"]',
        'input[name="cardnumber"]',
        'input[autocomplete="cc-number"]',
        'input[placeholder*="xxxx" i]',
      ]),
    );
  });

  it('talks only to the sandbox API', () => {
    expect(SANDBOX_API_ORIGIN).toBe('https://sandbox-api.paddle.com');
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../scripts/billing-pass-sandbox-rehearsal.ts'),
      'utf8',
    );
    expect(source).not.toContain('https://api.paddle.com');
    const caller = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../../.github/workflows/billing-checkout-revocation-rehearsal.yml',
      ),
      'utf8',
    );
    expect(caller).toContain('environment: Sandbox');
    expect(caller).toContain("github.ref == 'refs/heads/codex/ws1b-pricing-story-pass'");
    expect(caller).toContain('PADDLE_ENV: sandbox');
    expect(caller).not.toContain('PADDLE_ENV: production');
    expect(caller).toContain('scripts/billing-pass-sandbox-rehearsal.ts');
    expect(caller).toContain('Load the sandbox operator key');
    expect(caller).toContain('Name the sandbox boundary shape');
    expect(caller).toContain("github.event.inputs.rehearsal == 'pass'");
    expect(caller).toContain("github.event.inputs.rehearsal != 'pass'");
    expect(caller).not.toContain('secrets: inherit');
    expect(caller).not.toContain('workflow_call:');
    expect(caller).not.toMatch(/^ {2}pass:/m);
    expect(caller).toContain('pass-sandbox-shots');
  });

  it('charges the card button and keeps checkout diagnostics free of secrets', () => {
    expect(isCardPayButton('Pay now')).toBe(true);
    expect(isCardPayButton('Pay $19.00')).toBe(true);
    expect(isCardPayButton('Pay $20.69')).toBe(true);
    expect(isCardPayButton('Subscribe now')).toBe(true);
    expect(isCardPayButton('PayPal')).toBe(false);
    expect(isCardPayButton('Apple Pay')).toBe(false);
    expect(isCardPayButton('Payment method')).toBe(false);
    expect(sandboxFieldToken('cardNumberInput', 'shown')).toBe('cardNumberInput:shown');
    expect(sandboxFieldToken('cardPaymentFormSubmitButton', 'disabled')).toBe(
      'cardPaymentFormSubmitButton:disabled',
    );
    expect(sandboxFieldToken('cardNumberInput', '4242424242424242')).toBeNull();
    expect(sandboxFieldToken('https://secret.example', 'shown')).toBeNull();
    expect(
      sandboxCheckoutEvent('checkout.error', 'transaction_checkout_url_domain_is_not_approved'),
    ).toBe('checkout.error:transaction_checkout_url_domain_is_not_approved');
    expect(sandboxCheckoutEvent('checkout.loaded', '')).toBe('checkout.loaded');
    expect(sandboxCheckoutEvent('https://secret.example', 'pdl_sdbx_apikey')).toBeNull();
    expect(sandboxCheckoutEvent('checkout.error', 'https://secret.example')).toBeNull();
  });
});
