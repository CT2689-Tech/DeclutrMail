# Paddle sandbox configuration inspection

Owner and integration: current launch-readiness chat, isolated worktree branch
`codex/paddle-sandbox-inspection`, based on fresh main `b07877b3`. Owned files:
the manual inspection workflow, its Node script/tests, the CI contract step,
this audit and an implementation-log follow-up. Only the independent dependency
update PR was open at preparation. No runtime adapter, checkout, manifest,
subscription, webhook authentication, deployment or shared contract change.

## Access gap and bounded inspection

The callable tool inventory still has no Paddle tools. Existing GitHub Environment
`Sandbox` contains a `PADDLE_API_KEY` secret name; metadata alone proves neither
validity nor scope. The existing provisioning workflow creates products/prices
and is inappropriate for a read-only check. The new manual workflow executes only
on main, binds that Sandbox environment, and has contents-read permission.

GitHub environment secrets may fall back to repository secrets. Before any request,
the script requires literal `PADDLE_ENV=sandbox` and a full modern sandbox API-key
format. Live, legacy, missing and malformed keys fail locally. Credentials stay
inside GitHub's existing store/runner. There is no selectable host, provider mode
or arbitrary query. Requests use GET and reject redirects on
`https://sandbox-api.paddle.com` only, ordered as products, prices, then notification
destinations. Each section has at most five 200-row pages; each request has a
15-second deadline covering body consumption and a 2 MiB body cap. Next-page
URLs are validated for the fixed host/path and matching last-row cursor, then
reconstructed with fixed parameters. The supplied URL is never followed.

The sanitized one-day artifact exposes validated catalog IDs, active status,
closed canonical SKUs, unit amount/currency and billing cycle. Unknown SKUs are
null: manually created catalog entities may lack our SKU, so this is not a claim
that usable prices are absent. Destinations expose validated IDs, active/version/
traffic metadata, a category identifying the exact production API origin, a known
callback-path match, query/fragment and credential-presence booleans, consumed
adapter event names, and a count for other event names. No destination addresses,
arbitrary descriptions/names/custom data, endpoint secret keys, customers,
transactions, payment details, raw provider bodies or exception text are emitted.
Production destination classification is a configuration observation, not a
runtime health or successful delivery claim.

Sections distinguish complete, partial and unavailable. Failed/malformed reads,
unsafe pagination, duplicate rows and page caps remain explicit; validated prior
pages are retained. Later sections still run after an earlier read fails. The CLI
writes this sanitized failure report and exits nonzero for incomplete inspection;
artifact retention runs even when the inspection step fails. Workflow success
proves only these configuration reads, never purchase, webhook receipt, refund,
renewal or launch readiness. Deletion/expiry remains deliberately pending.

Provider schema and safety contracts use Paddle's primary documentation:
[API authentication and key formats](https://developer.paddle.com/api-reference/about/authentication/),
[product listing](https://developer.paddle.com/api-reference/products/list-products/),
[price listing](https://developer.paddle.com/api-reference/prices/list-prices/), and
[notification destinations](https://developer.paddle.com/api-reference/notification-settings/list-notification-settings/).

## Verification and delivery

Focused tests exercise live/legacy/malformed zero-request rejection, actual
15-second request abort with later-section continuation, fixed GET host and
redirect policy, pagination reconstruction/poisoned URLs/duplicates/page limits,
safe projections with embedded private markers, unknown SKU/destination states,
HTTP/transport/oversize/malformed failures, and the actual fail-closed CLI.
All ten focused tests passed, including the actual 15-second deadline. Three
negative controls independently removed the credential guard, selected the live
host, and added a destination secret to the projection; each failed as expected,
and the source was restored byte-for-byte. Actual CLI smoke with a synthetic fetch
preload produced three complete sections and exit0 without external requests;
missing credentials produced a safe report and exit1. Workspace typecheck passed;
full lint passed with six existing warnings; changed-file formatting/diff checks
and strict implementation-log validation (249 rows) passed. Workflow contracts
enforce manual main-only Sandbox-scoped read access and one-day sanitized failure
retention. The suite runs in the existing required CI
lint job. Local static checks, independent review, normal merge queue and actual
main inspection evidence are recorded separately when complete. No provider
configuration or payment is changed by this inspection.
