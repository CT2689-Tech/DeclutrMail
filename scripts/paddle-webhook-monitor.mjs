/** Events consumed by the deployed Paddle adapter; no provider payloads leave this module. */
export const PADDLE_REQUIRED_EVENTS = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.past_due',
  'transaction.completed',
  'transaction.payment_failed',
  'adjustment.created',
  'adjustment.updated',
];
export const PADDLE_EXPECTED_DESTINATION =
  'https://api.declutrmail.com/api/webhooks/billing/paddle';

export function paddleWebhookHealth(response) {
  if (!Array.isArray(response?.data))
    throw new Error('Invalid Paddle notification settings response');
  const matches = response.data.filter(
    (d) =>
      d?.active === true &&
      d.type === 'url' &&
      d.destination === PADDLE_EXPECTED_DESTINATION &&
      ['platform', 'all'].includes(d.traffic_source),
  );
  if (!matches.length) {
    if (response.meta?.pagination?.has_more !== false)
      throw new Error('Incomplete Paddle destination list; expected destination not verified');
    return {
      causes: [
        {
          status: 'BREACH',
          text: 'Expected Paddle production webhook destination is not active for platform events',
        },
      ],
      usage: { paddle_expected_destination_active: 0 },
    };
  }
  if (matches.length > 1)
    throw new Error('Multiple active Paddle destinations match the production callback');
  const events = matches[0].subscribed_events;
  if (!Array.isArray(events) || events.some((e) => typeof e?.name !== 'string'))
    throw new Error('Invalid Paddle subscribed events response');
  const names = new Set(events.map((e) => e.name));
  const missing = PADDLE_REQUIRED_EVENTS.filter((name) => !names.has(name));
  return {
    causes: missing.length
      ? missing.map((name) => ({
          status: 'BREACH',
          text: `Paddle production destination is missing required event ${name}`,
        }))
      : [
          {
            status: 'OK',
            text: 'Expected Paddle platform webhook is active with all adapter event subscriptions',
          },
        ],
    usage: { paddle_expected_destination_active: 1, paddle_missing_events: missing.length },
  };
}

export function paddleMonitorExpiry(expiresOn, now = Date.now()) {
  if (!expiresOn)
    return {
      causes: [{ status: 'WARN', text: 'Paddle watchdog key expiry date is not recorded' }],
      usage: {},
    };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn))
    throw new Error('Invalid Paddle watchdog expiry date');
  const expiry = Date.parse(`${expiresOn}T00:00:00Z`);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0, 10) !== expiresOn)
    throw new Error('Invalid Paddle watchdog expiry date');
  // The provider UI records a date. Warn conservatively from its UTC start,
  // without claiming that a still-valid key has already been refused.
  const days = Math.floor((expiry - now) / 86_400_000);
  return {
    usage: { paddle_watchdog_key_days_remaining: days },
    causes:
      days <= 14
        ? [
            {
              status: 'WARN',
              text: 'Paddle watchdog key expiry is within 14 days or has arrived; rotate the monitor credential',
            },
          ]
        : [],
  };
}
