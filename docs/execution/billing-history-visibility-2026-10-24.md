# Billing history visibility and invoice access

Root owns `codex/billing-history-visibility` in isolated worktree 58a9, based on
fresh main `4b79a6cb`. No overlapping Billing PR or unmerged dependency. Root is
the integration owner; the independent reviewer does not author implementation.

## Flow contract

An authenticated person opening Billing must be able to find payment history and
provider invoices independently of their current plan. Complimentary, Free,
expired Pass and cancelled subscriptions must not hide historical documents.
No history is an explicit empty state; failed, partial, omitted and bounded reads
remain distinct. Row dates, amounts, currencies and payment status come from the
provider. A supported document is fetched per click after workspace ownership is
rechecked; its signed URL is never cached or persisted. Filters act on loaded
records, and older-history limits stay explicit. Keep anchored sections, bottom
Account navigation and the quiet optional Pass row for complimentary Pro.

Scope: web/server history visibility, existing provider read adapters and service
ownership, affected tests/stories and this audit. No catalog, payment/plan mutation,
new SDK, invoice storage, schema, Gmail action or provider credentials. Purchases,
refunds, legal tax-document generation and payment-method changes are excluded.

## Findings and repairs

- P1, confirmed by failing regressions: client, screen and server prefetch inferred
  past payment history from the current subscription. The server manufactured an
  empty history when it was null. History now reads its own authenticated endpoint,
  including complimentary and Free accounts; current-plan errors do not hide it.
- P1, confirmed by real-database service tests: the API walked subscription IDs
  only. One-time paid Pass grants retain payment IDs, but the legacy webhook path
  did not create customer mappings. Reads now include workspace-owned customer
  IDs and bounded legacy subscription/paid Pass records, including expired/revoked
  grants. Manual grants without payment IDs never fabricate a paid invoice.
- P2: new scopes must not weaken tenant ownership. Both adapters require exact
  customer/subscription identities in returned rows. Legacy Pass lookup uses only
  transaction IDs derived from the workspace's existing grant ownership join.
  Documents are re-authorized against an owned listing on each click.
- P2, independent-review finding fixed: sequential provider fan-out had no shared
  deadline. One worker per provider (maximum two) now shares a 1.5-second provider
  budget; abort reaches HTTP and response-body reads. Completed rows are retained;
  unread scopes are reported as partial. Slower database/network responses can
  still recover client-side after the server hydration deadline.
- P2: Paddle draft/ready checkouts and card-verification artifacts are excluded;
  PDFs are offered only for supported nonzero completed/manual-billed invoices.
  Customer/subscription reads use a valid 30-row Paddle page and disclose more
  history. Capped/omitted/failed absence is never falsely reported as not found.
- P2, confirmed by an additional failing regression: signed document URLs were
  absent from query data but remained in mutation data. The download hook now
  navigates without returning the URL into either cache. Every click mints afresh.
- Discoverability: anchored navigation and section heading say "Payment history";
  the explanation includes historical subscriptions and one-time purchases.
  Existing invoice dates, amounts, statuses, filters and provider download/view
  controls remain available. Empty complimentary access does not imply a payment.

## Verification evidence

- 330 API/provider tests passed, including real PGlite workspace isolation,
  legacy expired/revoked Pass discovery, customer/subscription deduplication,
  caps, mixed-provider failures, shared timeout and actual stalled-body abort.
- 438 Billing web tests passed, including current-plan errors, null-subscription
  history and downloads, stream hydration, fresh per-click document reads, signed
  URL absence from both caches, and retained complimentary Pass behavior.
- Shared 946, config 38 and events 76 tests passed, including entitlement literal
  guards. All package types and generated route types passed.
- Lint passed with six existing warnings outside this change. Formatting passed.
- Production web build, bundle/prerender budgets and Storybook build passed.
  `CompedProWithPaymentHistory` adds the previously missed combined state;
  existing history stories cover loading, empty, failure, partial and omissions.
- Negative controls failed against the original client gate, subscription-only
  service, server-created empty history, broader PDF eligibility and URL-retaining
  mutation, then passed with the repairs.
- Isolated synthetic Postgres/Redis plus the production web build and API served
  HTTP: signed-out history 401; authenticated owned history 200 with the expected
  empty envelope; unowned document 404; Billing HTML 200 containing Payment history
  and No invoices yet. Verified synthetic identity and process working directories.
  No payment provider credential or production record was used for this smoke.
- Independent reviewer found ownership and deadline issues; both were repaired
  and re-reviewed with no remaining source blocker. The final download-cache,
  plan-error composition and timeout changes also passed independent re-review.
- UI code reviewed against React best practices and fresh Web Interface Guidelines;
  existing product tokens/anchors retained, filters labelled and named, focus and
  responsive behavior preserved in source. This does not claim browser validation.

## Resumed browser verification

The user unlocked the Mac. Built-in browser checks passed on the production build
of runtime candidate `5a2193bc`, with isolated synthetic auth and current-plan
routes. A workspace-owned local fixture proxy supplied only the invoice list,
per-click document response and failure/delay cases; this is not a live provider
PDF rehearsal. The real empty-history endpoint was also exercised.

Verified complimentary Pro with no subscription; Payment history anchor and
keyboard focus; paid-status and native-calendar date filters; no matches and
Clear filters; mouse, keyboard and 320px downloads (three valid synthetic PDFs);
502 history failure and Try again recovery; partial records retained; current-plan
failure with independently accessible invoices; 2.6s loading then client recovery;
dark/light themes; and leaving/reopening Billing through bottom Account navigation.
The 320px page had no horizontal overflow and kept the Download control above the
bottom navigation. Stable and delayed reads had no console or hydration errors.
Screenshots and privacy-safe download events are in the task's local history-repair
evidence folder; no real account data is committed here.

The independent reviewer inspected source and desktop/phone/error evidence and
reported no remaining merge blocker. The synthetic grant/tier were restored,
grant/subscription counts returned to zero, temporary services were stopped, and
the three temporary download files were removed. No source runtime change followed
this successful walkthrough. The original candidate's normal PR CI, CodeQL and all
four authenticated browser lanes passed; this documentation refresh precedes the
final candidate checks.

## Remaining release gates

Finish the protected PR/queue/main checks and normal deployment. Verify exact
Vercel and Cloud Run serving identities, then authenticated live history and its
honest empty/populated result. Confirm visible account identity before examining
its records. Synthetic download success does not establish live provider delivery.

No production billing or Gmail state has been changed. The reported account's
actual payment history has not been inferred from the missing UI. The earlier
visual score did not validate this functional flow; rescore only after live proof.

## Opportunities and boundaries

1. Implemented: discoverable, plan-independent payment history and supported
   provider documents, with honest incomplete states and scoped ownership.
2. Deferred: self-serve older-history pagination. Current bounded reads provide
   "Request older invoices"; adding cursors needs a separate API/UI contract and
   multi-scope pagination design. Do not describe this list as lifetime-complete.
3. Out of scope: new receipt generation or Indian GST invoice policy. Provider-owned
   links and the existing ADR-0035 ownership distinction are retained.
