# DeclutrMail agent conventions

## Paddle Billing

- This repository uses Paddle Billing API v2 through the existing server-side
  adapter at `apps/api/src/billing/paddle.adapter.ts` and
  `@paddle/paddle-js` for the browser overlay. Do not replace this with a
  second checkout SDK or a server-created checkout session without an explicit
  architecture decision.
- Keep environments strictly separate. Use the `paddle-sandbox` MCP server,
  sandbox API key, sandbox catalog, and `PADDLE_ENV=sandbox` for development and
  verification. Use `paddle-live` only for an explicitly approved production
  cutover. Never use a live key for exploratory reads or tests.
- Runtime billing is fail-closed. The API requires `BILLING_ENABLED=true`,
  `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, and `PADDLE_WEBHOOK_SECRET`; billing
  remains disabled until those values are provisioned in GCP Secret Manager and
  the deploy manifest binds them to the API service only.
- Paddle webhooks are authoritative. Preserve the raw request body, verify
  `Paddle-Signature` (`ts` plus every `h1`) with the five-second skew guard,
  reject invalid signatures before state writes, and keep event handling
  idempotent through subscription-event deduplication.
- Never trust browser-supplied `custom_data` for workspace attribution without
  the server HMAC signature. Never log API keys, client tokens, webhook
  secrets, checkout custom data, message contents, or payment details.
- Catalog IDs differ between sandbox and live. Provision and verify each
  environment independently; do not copy sandbox IDs into a live deployment.
- Before any live write (creating products/prices, changing subscriptions,
  cancelling, refunding, rotating keys, or changing webhooks), state the
  intended MCP server and obtain explicit confirmation. Prefer read-only
  inspection first.
- Required verification sequence: catalog read → notification destination
  read → sandbox purchase/webhook/refund rehearsal → live low-value purchase
  and immediate refund at cutover. Razorpay remains a separate provider path.

## Observability

- Sentry and PostHog are optional telemetry; product behavior must never depend
  on either service being available.
- PostHog browser events are consent-gated. Do not add analytics events that
  include Gmail message bodies, recipients, tokens, or other mailbox content.
- Treat Supabase platform/dashboard probe errors separately from application
  errors. Do not lower PostgreSQL logging thresholds to hide noise. Filter or
  alert on known platform signatures while retaining raw logs for forensics.
