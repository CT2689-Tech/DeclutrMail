# Architecture Decision Records

ADRs record rules that constrain how code gets written, each with the reason
behind it. They have no build status: a rule is either followed or violated.

The old D-numbered Implementation Plan was retired on 2026-11-17 (founder
decision). Many ADRs still cite D-numbers; read those citations as history. An
ADR stands on its own stated reason, never on a D-number.

ADRs follow the template at [`0000-template.md`](./0000-template.md).
Status values: Proposed | Accepted | Superseded by ADR-NNNN.

## Index

Numbers 0014 and 0037 were each used twice, and 0026 was never used. Keep both
files of each duplicated pair and use the next free number for new ADRs.

| ADR | Status | Title |
| --- | --- | --- |
| [0000](./0000-template.md) | Template | Template for new ADRs |
| [0001](./0001-drizzle-orm.md) | Accepted | Drizzle as the backend ORM |
| [0002](./0002-pr-b-unauthenticated-oauth-connect.md) | Accepted | PR-B ships an unauthenticated Gmail OAuth connect (pre-auth bootstrap) |
| [0003](./0003-base-declutr-worker-framework-agnostic.md) | Accepted | `BaseDeclutrWorker` is a framework-agnostic abstract class, not a NestJS `WorkerHost` |
| [0004](./0004-d7-allowlist-amendment-data-capture.md) | Accepted | D7 storage-allowlist amendment — capture To/Cc + List-Unsubscribe + outbound tagging |
| [0005](./0005-gmail-quota-rate-limiter-resumable-backfill.md) | Accepted | Gmail quota — sliding-window rate limiter + resumable backfill |
| [0006](./0006-unsubscribe-cascade-rfc8058-mailto-manual.md) | Accepted | Unsubscribe cascade — RFC 8058 one-click, mailto deferred manual, fallback none |
| [0007](./0007-component-placement-rule.md) | Accepted | Component placement — lazy promotion + spec override |
| [0008](./0008-api-envelope-and-module-template.md) | Accepted | API response envelope, NestJS module template, read-service pattern |
| [0009](./0009-dashboard-palette-extension.md) | Superseded by ADR-0017 (2026-06-03) | Dashboard-surface palette extension (amends D2) |
| [0010](./0010-dashboard-motion-extension.md) | Superseded (2026-11-17) — packages/shared/src/tokens/tok… | Dashboard-surface motion budget extension (amends D213) |
| [0011](./0011-editorial-copy-scope.md) | Accepted | Editorial copy voice scope (amends D209) |
| [0012](./0012-senders-intent-groups.md) | Accepted | Senders intent-grouped tables (amends D38, D39) |
| [0013](./0013-destructive-action-pipeline.md) | Accepted | Async destructive-action pipeline (Archive slice) |
| [0014](./0014-error-code-registry.md) | Accepted | Centralized error-code registry |
| [0014](./0014-senders-total-received-counter.md) | Proposed | `senders.total_received` denormalized counter |
| [0015](./0015-action-registry.md) | Superseded by ADR-0019 (partial — narrower scope, single… | Action Registry |
| [0016](./0016-senders-visual-language.md) | Proposed | Senders + Sender-Detail visual language alignment |
| [0017](./0017-retire-dashboard-violet.md) | Superseded by ADR-0037 (editorial plum replaced the teal… | Retire dashboard violet accent (supersedes ADR-0009) |
| [0018](./0018-senders-mobile-dialect.md) | Accepted — core dialect shipped 2026-08-30 (see | Senders mobile dialect |
| [0019](./0019-verb-registry-and-kauld.md) | Accepted | K/A/U/L/D verb set + Verb Registry primitive (amends D227) |
| [0020](./0020-unified-actions-endpoint-composite.md) | Accepted | Unified `POST /api/actions` endpoint + composite action shape |
| [0021](./0021-d7-allowlist-amendment-message-size.md) | Accepted | D7 storage-allowlist amendment — capture Gmail `sizeEstimate` |
| [0022](./0022-postgres-supabase-pre-launch.md) | Accepted | Postgres on Supabase pre-launch (amends D158) |
| [0023](./0023-vendor-billing-guardrails.md) | Accepted | Upstash Fixed plan + three-layer billing guardrails on all metered vendors |
| [0024](./0024-avatar-monogram-first.md) | Accepted | Sender avatars are monogram-first with a first-party logo layer |
| [0025](./0025-feature-flag-manifest.md) | Accepted | Centralized feature-flag manifest with env-var kill switches |
| [0027](./0027-billing-presentation-state.md) | Accepted | Billing presentation state — one derived story per screen |
| [0028](./0028-action-reach-archived-delete.md) | Accepted (founder-approved 2026-07-27 as "item A"; built… | Action reach: Delete can include archived mail |
| [0029](./0029-senders-wire-model.md) | Accepted | The senders wire row IS the model; derived fields extend it by spread |
| [0030](./0030-positioning-preview-guarantee.md) | Accepted; amended 2026-11-17 (default positioning, not a… | Positioning — sell the preview guarantee, not the sender unit |
| [0031](./0031-protection-evidence-taxonomy.md) | Proposed — needs founder ratification (see FOUNDER-FOLLOW… | Protection evidence splits into strong / weak / manual, and only the weak half gets reviewed |
| [0032](./0032-unsubscribe-failure-time-cascade.md) | Accepted | Unsubscribe cascade runs at FAILURE time, not only at derivation time |
| [0033](./0033-one-definition-of-live-subscription.md) | Accepted | One definition of "live" — the subscription slot is gated by five surfaces, and they change together |
| [0034](./0034-brand-icon-cache.md) | Accepted | Brand logos return through a first-party, globally-cached icon endpoint |
| [0035](./0035-merchant-of-record-billing-artifacts.md) | Accepted | The merchant-of-record split decides who owns each billing artifact — and it is not symmetric |
| [0036](./0036-brand-logo.md) | Accepted — locked by the founder on 2026-11-16 after | Brand logo — mark, wordmark and the surfaces that carry them |
| [0037](./0037-editorial-plum-palette.md) | Accepted | Editorial plum across product and marketing |
| [0037](./0037-one-window-for-sender-activity.md) | Accepted | One window for a sender's activity |
| [0038](./0038-postgres-reaches-the-app-as-postgres.md) | Accepted | The Data API roles hold no privileges in `public` |
| [0039](./0039-an-exposed-id-is-a-contract.md) | Accepted | An id that crosses the API boundary is a contract |
| [0040](./0040-complimentary-tier-is-a-floor.md) | Accepted | A complimentary tier is a floor, never a written tier |
| [0041](./0041-keep-is-not-protection.md) | Accepted | Keep is not protection, and reach is controlled on one screen |
| [0042](./0042-one-screen-one-number-one-list.md) | Accepted | One screen — one title, one number, one list, one action |
| [0043](./0043-warm-editorial-product-system.md) | Accepted | Warm Editorial product system |
| [0044](./0044-billing-refunds-and-permanent-founding-allocation.md) | Accepted policy; implementation and release evidence trac… | Upgrade refunds, permanent Founding allocation and billing notices |
| [0045](./0045-inr-purchase-readiness-pause.md) | (see file) | Pause new INR purchases pending readiness |
| [0046](./0046-sandbox-revocable-checkout-preparation.md) | (see file) | Prepare provider-revocable checkout in sandbox |
| [0047](./0047-durable-checkout-attempts.md) | (see file) | Retain exact checkout identity through recovery |

| [0048](./0048-mcp-connector-is-a-second-client.md) | Accepted | MCP connector is a second client of the action pipeline | ADR-0020, ADR-0028 |

## Authoring an ADR

1. Copy `0000-template.md` to `NNNN-kebab-title.md` using the next free
   number.
2. Fill in status, date and deciders, and name what backs the rule: an
   external policy, a published claim, an incident, a manifest or a test.
3. Add the row to the index above.
4. Open a PR. The ADR is reviewed alongside the code change that
   triggered it.
