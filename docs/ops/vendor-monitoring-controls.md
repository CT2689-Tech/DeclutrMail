# Vendor monitoring controls

Relates to D117, D156, D159 and D160. These checks observe provider configuration;
they do not certify payments, application uptime or dashboard usability.

## Vercel: compare the same billing measures

The watchdog reads the active team budget and current-cycle on-demand spend,
using the contracts exposed by `vercel budgets inspect` (CLI 64.7.0):

- `GET /v1/budgets?scope=team&teamId=…`: `amount` is USD.
- `GET /teams/{id}/spend`: `data.currentSpend` is integer cents.
- Notification and pause thresholds come from the active provider budget.
  Missing budget, no pause, or no advance notification is a breach. An
  unavailable or malformed read remains an error.
- Calendar-month FOCUS billed charges remain a separate finance observation.
  They can include subscription charges and use a different period from the
  current-cycle on-demand budget. The old default calendar warning is removed;
  an explicitly configured `VERCEL_MTD_COST_WARN_USD` still applies independently.

No provider budget, plan, notification or pause setting is changed by collection.
See [spend management](https://vercel.com/docs/spend-management) and
[budget inspection](https://vercel.com/docs/cli/budgets).

## Paddle: an independent read-only monitor

The scheduled production watchdog uses `PADDLE_WATCHDOG_API_KEY`, with only
`notification_setting.read`, instead of the application billing key. Store it
only in the repository's encrypted Actions secret. Record its provider expiry
date in `PADDLE_WATCHDOG_KEY_EXPIRES_ON` (`YYYY-MM-DD`); a missing date or expiry
within 14 days warns. Wrong environment key prefixes fail before the request.
An absent production monitor key is an error, never an unconfigured success.

The read verifies that the exact deployed callback is active for platform
traffic and subscribes to all eleven events handled by the billing adapter.
In particular, `adjustment.updated` covers later refund-status changes. A
contract test compares this required-event list with the adapter's cases.
An unrelated active destination or a simulations-only destination cannot pass.
Incomplete lists and malformed responses cannot establish a healthy callback.

The existing application `PADDLE_API_KEY` secret and GCP runtime credential are
separate. Do not replace or copy them to repair monitoring. The nonpayment
inspection workflow excludes all Paddle and Razorpay credentials before
starting the collector.

Provider writes (including creating the monitor key and adding a subscribed
event) require the production approval in `AGENTS.md`. Merging collector code
does not establish that those provider changes have happened. After approved
setup, verify the destination and permissions, then collect from main. Reuse
existing purchase/refund and alert-delivery evidence; no new payment or test
email is needed for this configuration change.

See [Paddle permissions](https://developer.paddle.com/api-reference/about/permissions/)
and [notification settings](https://developer.paddle.com/api-reference/notification-settings/list-notification-settings/).

## Interpret the remaining sources honestly

- A Google Cloud budget alert does not cap spending. Exported project usage
  charges, credits, export age and the budget-period linear estimate remain
  distinct from a paid invoice. Do not increase a budget or shrink production
  capacity just to remove a warning.
- Redis command volume is a diagnostic heuristic, not proof of a provider
  billing quota. Inspect the actual plan, storage and bandwidth, while retaining
  lifecycle and spend-cap checks. A fixed-plan observation does not authorize
  a paid test or plan change.
- Anthropic Admin API authentication failure remains unavailable cost data.
  An ordinary inference key or a configured secret name does not prove cost
  access. Manual Console cost verification does not repair the automated read.
- Existing alert-delivery receipts and successful routing verification should
  be reused unless routing behavior or recipients change.

Before declaring the shared monitoring dashboard or private finance report
usable, open its exact URL in the intended authenticated account and verify
panel rendering and freshness. Collection success alone does not prove this.

Private provider observations and launch evidence are retained outside the
public repository. A broader launch decision must name genuine budget breaches,
unavailable cost sources and pending provider approvals separately from shipped
collector fixes.
