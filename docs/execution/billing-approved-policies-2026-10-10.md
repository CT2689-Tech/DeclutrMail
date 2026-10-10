# Approved billing policy follow-ups

## Flow contract and authorization

The founder approved three policies on October 10: a full refund of an upgrade-only charge reverses only the upgrade; a paid Founding seat remains used after refund or account deletion; providers own receipts/invoices while DeclutrMail sends cancellation, pause, access-deadline and grant-expiry notices. The already approved deletion gate never automatically cancels or refunds.

An upgrade reversal must preserve the previously paid plan's remaining access and renewal terms, using exact provider transaction and prior-plan evidence. It must not create another charge, extend the original paid-through period, undo a customer's cancellation, revive a chargeback, or guess at a plan when evidence is ambiguous. Provider writes stay outside database transactions. Pending/rejected refunds do not reverse an upgrade. Full ordinary subscription refunds keep their existing settlement policy. A sandbox rehearsal is required before releasing refund behavior.

Founding allocation must retain one permanent, metadata-only paid-redemption record per provider subscription. Refunds, cancellation and workspace deletion cannot return a seat. Existing allocated rows remain recognized; complimentary grants cannot mint a redemption. The first-250 cap and provider catalog/price-lock behavior remain enforced atomically.

App notices describe DeclutrMail access, rather than duplicating provider payment receipts. Notices must be durable and deduplicated, honor suppression, retain support replies, and recheck deadline/grant state before delayed delivery. No Gmail content belongs in notices. Historic state is not backfilled into email sends.

## Ownership and dependencies

The root agent owns Billing service/webhook/reconciliation/adapters and shared contracts, notification templates and worker composition, policy documentation and all integration. Follow-ups depend on deletion PR #918 and copy PR #919; those PRs are being validated and queued separately. No other session owns these files. Independent architecture/privacy/design review is required before delivery.

The existing Paddle adapter and browser SDK remain authoritative. Sandbox-only verification uses the existing GitHub Sandbox credential route because Paddle MCP tools are not exposed in this chat. Catalog and notification-destination reads succeeded in workflow 38074997116; all five destinations were inactive. A temporary isolated rehearsal destination must not replace any live destination. Credentials must stay in provider/GitHub/runtime memory, never in repository files or reports.

India seller/GST readiness and reusable checkout revocation remain unresolved decisions. Complimentary duration, inbox grandfathering, metering, prices and default billing interval are unchanged.

## Verification

The permanent Founding ledger core passes 261 billing tests, full repository typecheck and lint (six existing warnings), 31 Privacy/support tests and implementation-log validation. Deletion integration, final independent review and release remain pending. Upgrade-refund and notice implementation are separate follow-ups; no provider financial write or email send has occurred.

## Permanent Founding implementation evidence

The approved allocation policy is implemented in the existing append-only subscription event ledger. One statement counts durable references plus surviving legacy rows without double-counting; allocations share the original global advisory lock. Trial snapshots cannot allocate new seats. Legacy records commit in a separate preservation transaction before deletion inspection and workspace locking, and workspace-identity drift fails closed. Privacy copy names the retained metadata and excludes email, workspace and Gmail data.

Core billing suites passed 261 tests; final guard/ledger suites passed 17 tests, API typecheck and changed-file lint. Full repository typecheck/lint and 31 Privacy/support tests passed earlier. Independent final architecture/privacy review passed 17 tests, typecheck, lint and diff checks and found no blocker. Two real isolated Postgres races (postgres-js and node-postgres) proved concurrent legacy webhook/deletion completes without deadlock, the marker is committed and visible on a separate connection before cascade, and the seat count stays used. A negative control omitting legacy preservation failed the deletion regression; source was restored. An initial test incorrectly attempted an independent read through PGlite's single connection inside a transaction and timed out; the fixture was corrected, with committed visibility verified separately in real Postgres.

Historical allocations already erased by prior deletions cannot be reconstructed from the surviving database. No migration, provider write, real account deletion or email send is included. Deletion #918 is a required landing dependency.
