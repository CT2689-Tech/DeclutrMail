import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PADDLE_REQUIRED_EVENTS,
  PADDLE_EXPECTED_DESTINATION,
  paddleWebhookHealth,
  paddleMonitorExpiry,
} from './paddle-webhook-monitor.mjs';

const destination = {
  active: true,
  type: 'url',
  destination: PADDLE_EXPECTED_DESTINATION,
  traffic_source: 'platform',
  subscribed_events: PADDLE_REQUIRED_EVENTS.map((name) => ({ name })),
  endpoint_secret_key: 'PRIVATE_PROVIDER_FIELD_DO_NOT_EXPOSE',
};
const response = (d) => ({ data: d, meta: { pagination: { has_more: false } } });

test('only the expected active platform callback with every consumed event is healthy', () => {
  const result = paddleWebhookHealth(response([destination]));
  assert.equal(result.causes[0].status, 'OK');
  assert.equal(result.usage.paddle_missing_events, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_FIELD/);
  for (const altered of [
    { ...destination, active: false },
    { ...destination, traffic_source: 'simulation' },
    { ...destination, destination: 'https://other.example.test/webhook' },
  ])
    assert.equal(paddleWebhookHealth(response([altered])).causes[0].status, 'BREACH');
});

test('the observed missing refund-status subscription fails even while the destination is active', () => {
  const d = {
    ...destination,
    subscribed_events: destination.subscribed_events.filter((e) => e.name !== 'adjustment.updated'),
  };
  assert.deepEqual(paddleWebhookHealth(response([d])).causes, [
    {
      status: 'BREACH',
      text: 'Paddle production destination is missing required event adjustment.updated',
    },
  ]);
});

test('incomplete, ambiguous and malformed reads cannot become a healthy or empty result', () => {
  for (const value of [
    {},
    { data: null },
    { data: [] },
    { data: [], meta: { pagination: { has_more: true } } },
    response([destination, destination]),
    response([{ ...destination, subscribed_events: null }]),
  ])
    assert.throws(() => paddleWebhookHealth(value));
  // Positive proof of the exact destination does not need unrelated later pages.
  assert.equal(
    paddleWebhookHealth({ data: [destination], meta: { pagination: { has_more: true } } }).causes[0]
      .status,
    'OK',
  );
});

test('key rotation is warned ahead of expiry and unknown dates stay explicit', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(paddleMonitorExpiry('2027-01-25', now).causes.length, 0);
  assert.equal(paddleMonitorExpiry('2026-11-09', now).causes[0].status, 'WARN');
  assert.equal(paddleMonitorExpiry('2026-10-26', now).causes[0].status, 'WARN');
  assert.equal(paddleMonitorExpiry(undefined, now).causes[0].status, 'WARN');
  for (const date of ['2027-02-31', 'garbage', '2027-1-25'])
    assert.throws(() => paddleMonitorExpiry(date, now));
});

test('subscription coverage remains in step with deployed adapter event handlers', () => {
  const source = readFileSync(
    new URL('../apps/api/src/billing/paddle.adapter.ts', import.meta.url),
    'utf8',
  );
  const events = [
    ...source.matchAll(/case '(subscription\.[a-z_]+|transaction\.[a-z_]+|adjustment\.[a-z_]+)'/g),
  ].map((m) => m[1]);
  assert.deepEqual([...new Set(events)].sort(), [...PADDLE_REQUIRED_EVENTS].sort());
});
