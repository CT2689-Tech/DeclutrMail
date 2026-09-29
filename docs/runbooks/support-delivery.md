# Support request delivery

The authenticated API acknowledges `POST /api/support-request` with HTTP 202 and
`status: accepted` only after its dedicated `support-request` BullMQ enqueue
succeeds. This is not a delivery receipt. The API needs Redis, not a Resend key.
The worker process uses its existing Resend credential and suppression checks.

The queue accepts only a bounded subject/message and server-derived account
identity/Reply-To. Recipient is always `support@declutrmail.com`. Identical
submissions share a queue ID and provider idempotency key; timestamp changes do
not change the email body. Provider acceptance is not proof of inbox receipt.

## Failure handling

- Queue outage: API returns service unavailable; UI keeps the user's text and
  offers a mailto fallback. The producer does not buffer hidden later sends.
- Transient delivery error: three total attempts, exponential backoff starting
  at five seconds. The same provider key accompanies every attempt.
- Disabled provider, suppression or permanent rejection: fail closed immediately.
- Exhausted/permanent failures enter the existing dead-letter/observer alert path.
  The permanent record contains queue/job metadata and user ID, not support text
  or Reply-To. No provider exception text is added to support-worker errors.
- Investigate worker/provider readiness and suppression before retrying. Retry the
  original failed Redis job through authorized queue tooling; the redacted database
  dead-letter payload cannot reconstruct the message. If it has been cleaned up,
  use the account ID to arrange follow-up rather than pretending a resend occurred.
  Retrying a real message sends email and needs the corresponding authorization.

## Retention and release check

Successful queue payloads are removed immediately after provider acceptance.
Failed jobs are configured for seven days or 1,000 records; BullMQ prunes on later
queue activity, so this is not an exact TTL. Waiting/retrying jobs remain until
processed. Delivered correspondence remains in the support mailbox. These boundaries
are disclosed in Privacy section 7 and the amended support design.

Local tests use fake queue/provider ports and do not certify production delivery.
Before launch, perform an authorized controlled submission, verify the worker
consumes it, the support inbox receives it, Reply-To reaches the submitting account,
and a controlled failure appears in the existing operational alert surface. Do not
put request text or recipient addresses into screenshots/log exports used as evidence.
