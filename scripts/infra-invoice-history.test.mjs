import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceHistoryWidget } from './infra-invoice-history.mjs';
const entry = {
  vendor: 'Google Cloud',
  month: '2026-07',
  amount: 78.12,
  currency: 'USD',
  kind: 'statement',
  scope: 'billing account',
  sourceUrl: 'https://console.cloud.google.com/billing/example/history',
};
const ledger = (entries) => ({ version: 1, verifiedAt: '2026-09-05T19:00:00Z', entries });
test('charges are not labelled paid without transaction evidence, with explicit account scope', () => {
  const text = invoiceHistoryWidget(ledger([entry])).text.content;
  assert.match(text, /\$78\.12/);
  assert.match(text, /Payment unverified/);
  assert.match(text, /billing account/);
  assert.match(
    invoiceHistoryWidget(ledger([{ ...entry, paidOn: '2026-08-06' }])).text.content,
    /Paid 2026-08-06/,
  );
});
test('duplicate documents and malformed or mixed-currency amounts cannot misstate totals', () => {
  assert.throws(() => invoiceHistoryWidget(ledger([entry, entry])), /Duplicate/);
  for (const amount of [null, '78.12', NaN, -1])
    assert.throws(() => invoiceHistoryWidget(ledger([{ ...entry, amount }])));
  assert.throws(() => invoiceHistoryWidget(ledger([{ ...entry, currency: 'EUR' }])), /currency/);
  assert.throws(
    () => invoiceHistoryWidget(ledger([{ ...entry, sourceUrl: 'javascript:alert(1)' }])),
    /source/,
  );
});

test('vendor columns cannot silently combine different scopes or date bases', () => {
  assert.throws(
    () => invoiceHistoryWidget(ledger([entry, { ...entry, month: '2026-08', scope: 'project' }])),
    /Mixed scope/,
  );
  assert.throws(
    () =>
      invoiceHistoryWidget(ledger([entry, { ...entry, month: '2026-08', basis: 'payment month' }])),
    /Mixed scope/,
  );
});
