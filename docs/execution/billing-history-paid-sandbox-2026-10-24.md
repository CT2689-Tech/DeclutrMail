# Paid sandbox payment history and invoice audit

## Flow contract

Integration owner: Codex root in isolated worktree `58a9`, branch
`codex/paddle-history-sandbox`, based on current main. No dependencies or
overlapping Billing PR was found at the start. Scope is payment history and
invoice downloads through the existing API adapter and production UI.

Use only Paddle sandbox, its catalog and a verified synthetic paid customer.
Prefer an existing completed fixture over a new purchase. Application data belongs
only in a disposable local/CI database. Exclude live credentials, live charges,
production data or settings, real Gmail, refunds and unrelated subscription changes.

Acceptance: a provider-confirmed completed nonzero transaction appears in the
authenticated account's history, with correct amount/date/status; filters and
revisit retain accurate state; clicking Download mints an owned provider URL and
produces a readable PDF that matches the sandbox invoice. A different account
cannot list or download it. Repeated downloads must use fresh authorization;
failed reads must stay distinct from empty history. Check keyboard and 320px
behavior. Preserve anchored sections, bottom Account navigation and existing plan
hierarchy. Record actual provider proof separately from synthetic/local tests.

## Access investigation

- Fresh read-only sandbox inspection:
  [run 40122686164](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/40122686164).
  At `2026-10-24T18:52:22.294Z`, the existing Sandbox environment credential
  returned HTTP 403 for products, prices and notification destinations. All three
  sections remain unavailable; no catalog absence is inferred.
- `paddle-sandbox` is configured for `sandbox-mcp.paddle.com`, but its configured
  bearer-token environment variable is not available to this session and Paddle
  tools are not exposed. No live credential was inspected or used.
- The user signed in through the built-in browser. The visible workspace is
  DeclutrMail and the dashboard is explicitly Test mode/Sandbox. Authentication
  settings show the July-created sandbox key expired October 18, consistent with
  the July 20 update time of the existing GitHub Sandbox secret.
- The user approved and created a seven-day key expiring October 31, with only
  customer, subscription, transaction, product, price and notification-setting
  reads. No write permissions. The key was saved to the local login Keychain as
  `com.declutrmail.paddle-sandbox-history` for account `paddle-sandbox-readonly`.
  The user allowed its runtime Keychain read. Provider requests succeeded, and
  the dashboard shows six read permissions, zero write permissions, and October
  31 expiry. The shared CI secret is unchanged. No live key or payment/subscription
  write was used.
- The approved key read five active products, eleven active prices and eighteen
  notification destinations, all complete. This verifies read access, not the
  delivery health of each destination. The earlier 403 observations remain valid
  for the expired shared CI credential.
- Exact customer lookup initially returned no active fixture. The original
  rehearsal's cleanup archives customers; querying the same exact reserved
  identities with `status=active,archived` recovered them. No customer was
  reactivated and no broad customer enumeration was performed.

## Actual paid history and document verification

**Passed on the isolated application using real, completed sandbox payments.**
No new application defect was reproduced and no runtime product code changed.

Source: `74441492f754035734a37caf88fdf5f39ecbcb2b`, including the already merged
[history repair PR #1115](https://github.com/CT2689-Tech/DeclutrMail/pull/1115).
The Next.js production build and existing API adapter/service/controller handled
the real requests. The temporary API copy differs only in its explicit loopback
listen address; this harness change is not a product fix.

Paid fixtures came from the successful, previously authorized
[sandbox rehearsal 38215741104](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38215741104).
Each exact reserved synthetic customer was reverified against Paddle before
importing its customer mapping into the disposable database. Provider history
returned two completed nonzero Pass transactions and one completed nonzero annual
transaction, with no additional page. There was **no new checkout, charge, webhook
rehearsal, refund or subscription mutation in this audit**. The local account's
current access stayed Free; this verifies historical payments, not active paid
entitlements or fresh purchase-to-webhook attribution.

| Scenario                                              | Real sandbox records                                         | Browser result                                              |
| ----------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Historical Pass, verified customer mapping            | Two completed USD 20.69 payments, October 12                 | Both Paid rows displayed; both distinct invoices downloaded |
| Historical annual purchase, verified customer mapping | One completed USD 44.97 payment, October 12                  | Paid row displayed; annual invoice downloaded               |
| Legacy Pass, no customer mapping or subscription row  | Two verified transaction IDs in local expired/revoked grants | Both Paid rows recovered; invoice downloaded                |
| Never-paid synthetic account                          | No mapping, subscription or grant                            | Accurate "No invoices yet" state                            |

Local authenticated API assertions matched every row's transaction ID, amount,
currency, issued timestamp, Paid status and document availability to provider
evidence. All listings were complete, with zero omitted rows or unavailable
providers. This includes the legacy transaction fallback under the existing
provider deadline; its reads succeeded without raising the timeout.

The built-in browser downloaded actual provider PDFs through the production
Download control. The first used Enter; a repeated mouse click downloaded the
same invoice again. Safe request traces show a new ownership read followed by
`GET /transactions/:id/invoice` for each click. Document responses were
`Cache-Control: private, no-store`. No signed URL was saved in evidence.

Every distinct PDF had a valid PDF header and readable extracted text matching
the exact synthetic customer, transaction ID, invoice reference, issued date,
currency, paid marker and total. Pass and annual pages were rendered and visually
reviewed without clipping or unreadable content. Repeat and legacy downloads
matched the original Pass PDF bytes.

| Distinct provider PDF   |  Bytes | SHA-256                                                            |
| ----------------------- | -----: | ------------------------------------------------------------------ |
| Pass, newer transaction | 43,968 | `a1768235633a1c737c09e5f397cfb867f0ca9dea553e1dd9c2368b64d56bc285` |
| Pass, older transaction | 43,966 | `23c692cbfd1a2922b35f9e062cb8d4ff3e580928377b2720a6b444e0d8b081ef` |
| Annual                  | 44,900 | `51c79d6bee0ac9d7694438f3a54c50eb7aaba7f66f3be420e1961b389a775ea7` |

## Isolation, interaction and recovery checks

- Anonymous history and document requests returned 401. A second signed-in
  synthetic account received a complete empty history and 404 when requesting
  the first account's invoice, for Pass, annual and legacy scenarios.
- Status filtering excluded Paid rows when Due was selected. A native keyboard
  date change excluded earlier payments; Clear filters restored both rows.
  The browser driver's date `fill` changed the displayed value without firing
  React's change event; native keyboard input verified the actual product flow.
- Refresh and navigation from Settings back through bottom Account navigation
  retained accurate history. The Payment history anchor focused its section.
- At 320px, document width remained 320px, and the main, history section and
  filter controls had no horizontal overflow. Download worked at that width.
  Light and dark history views were inspected. The original theme and viewport
  override were restored.
- Browser warning/error logs were empty after the paid and revisit checks.
- The API and web listeners were verified at `127.0.0.1:4128` and
  `127.0.0.1:3128`, respectively. Dedicated Postgres/Redis also bind loopback.
  The provider credential was supplied only to the parent test runner and API,
  never the web process or a secret file. Browser cookies were not exported.
- The test-process guard refused live/foreign origins and provider writes and
  disabled external redirects. The recorded provider requests were sandbox GETs.
  PDF downloads were browser transfers from the provider-returned document URLs.
- Loading was observed before paid rows. Failed/partial/omitted/capped reads and
  download error recovery remain covered by the existing automated suites, not
  by a newly induced provider outage in this run. Checkout, refunds, Undo and
  mutation concurrency are outside this read-only history/document flow.

On source `74441492f754035734a37caf88fdf5f39ecbcb2b`, 250 API/adapter/service
tests and 39 history/UI/hydration tests passed. An isolated production build
passed. The initial temporary build lacked the shared-package path needed by a
fixture; adding the temporary package symlink resolved it without a product edit.
96 migrations and synthetic seeds were applied only to a dedicated loopback test
database.

## Findings, follow-ups and delivery state

- **Application:** no new reproducible defect. The current history repair handles
  customer-linked payments and historical-only Pass grants with actual provider
  documents. No application redeployment is needed for this evidence-only change.
- **Access:** the shared GitHub Sandbox key remains expired, and the configured
  sandbox MCP entry still lacks its environment token in this chat. The temporary
  approved Keychain key enables this isolated test only; it does not repair those
  shared routes. Restoring the shared credential is separate from product
  correctness and was deliberately excluded from this approval.
- **Deferred reliability opportunity:** a scheduled paid-history/PDF sandbox
  smoke could detect future provider/API drift. It needs a durable read-only CI
  credential and explicit fixture/retention ownership; no new automation or
  persistent paid fixture was created here.
- **Limits:** this run verifies a disposable authenticated app against paid
  sandbox history. It does not verify a paid production account, live documents,
  production credentials, active paid entitlements or a new purchase/webhook cycle.
  No production account, Gmail data, live provider setting or deployment changed.
- **Independent review:** the reviewer checked the sole intended documentation
  change, fixture/ownership/PDF proof summaries, all 39 successful sandbox GET
  traces, and desktop/320px/dark screenshots. No P1/P2 findings or product/privacy
  blocker. A P3 permission-wording correction was applied. The reviewer performed
  no provider requests, credential reads or mutations.
- **Cleanup:** the owned API/web runner stopped; both listeners are absent. The
  two dedicated database/cache containers and their anonymous volumes were
  removed, along with the isolated build, five downloaded PDFs and temporary PDF
  render images. Theme and viewport were restored; temporary tabs were closed and
  browser automation memory cleared. Only this audit document is intended for the
  PR. Screenshots, hashes and safe summaries remain in local task artifacts;
  raw provider PDFs and signed document links are excluded. The approved scoped
  key remains in Keychain with its October 31 expiry; shared credentials are
  unchanged.
