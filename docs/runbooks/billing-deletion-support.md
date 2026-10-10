# Resolving billing before account deletion

The product never cancels or refunds billing as part of deletion. Cancel in Billing, wait for the subscription to end, then retry deletion. Paused and scheduled-to-cancel subscriptions are still blockers. A locally canceled refund/dunning row requires an exact provider terminal-status read; a missing or unavailable provider response is not proof.

## Unresolved checkout attempts

The transient pending checkout can expire, be released or be replaced without invalidating a provider artifact. Each new attempt therefore has a retained `local.checkout_attempted` billing event. A known Razorpay subscription is recorded as `local.checkout_artifact` and can be checked exactly. Paddle overlay payloads do not carry an attempt identifier; the verified workspace attribution of one purchase cannot prove all attempts have finished. Those attempts need support review, even after the visible subscription ends.

Support must use the correct provider/environment, inspect every subscription and open transaction/link associated with the account (including payer aliases), and check each retained attempt. Canceling, refunding, or changing a production subscription needs separate explicit authorization and the normal provider workflow. This procedure itself performs no provider mutation. Never infer resolution from elapsed time, a browser success callback, an empty capped search, or the customer's “no charge” assertion.

After provider review confirms no outstanding payable artifacts and all known subscriptions are terminal, append one `local.checkout_attempt_resolved` event for each reviewed unknown attempt through an approved scoped administrative database workflow. Production account changes require task-specific authorization; do not run production database writes from a laptop. Preserve other attempts. The event must use the attempt's provider, a unique provider_event_id, processed_at set, and this metadata-only payload:

```json
{
  "workspaceId": "workspace UUID",
  "attemptId": "local_checkout_UUID",
  "resolution": "provider-reviewed",
  "operatorId": "opaque staff identifier",
  "evidenceReference": "internal support case identifier",
  "providerRefs": ["exact reviewed subscription identifiers"]
}
```

Use no customer name, email, credentials, payment details or free-form correspondence in this event. An empty providerRefs array is an explicit operator attestation that review found no subscription; never synthesize it automatically. The deletion guard checks every supplied reference against the provider again and still checks all local subscription rows. Record the completeness review and any provider actions in the support case. Then have the customer use “Check again” in Settings and request deletion again, or cancel an old pending deletion if they no longer want it.

## Limits of this safeguard

This guard prevents known ongoing billing and retains future attempt evidence. Historic attempts already released/overwritten/swept cannot be reconstructed from the current database. A previously issued Paddle workspace-only overlay payload also cannot be revoked by an operator resolution event and could be deliberately reused to buy a new subscription later. Closing that capability requires a separate checkout architecture decision; do not claim that an empty search or support attestation proves it impossible. Do not auto-resolve an unknown Paddle attempt using a workspace-level paid webhook.
