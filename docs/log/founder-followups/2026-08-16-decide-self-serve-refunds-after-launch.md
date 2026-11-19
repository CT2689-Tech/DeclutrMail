### 2026-08-16 — Decide whether refunds become self-serve after launch

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-16.
**Why:** Refunds are honoured by email today. A self-serve refund button would be a strong trust signal, but it is the only one-way money move on the billing page. The window (14 days) and the limit (once per customer) are already set in `POLICY` in `pricing.config.ts`; what is left is whether to build it at all.
**How:**
1. After launch, decide: is a refund self-serve, or does it stay by email?
2. If self-serve: decide whether annual plans and the Backlog Pass are included, and whether a refunded customer may buy again at once (allowed today).
3. Record the answer here; an agent then writes an ADR and builds it.
**Verifies by:** A decision recorded here and, if yes, an ADR and a merged PR.
**Who:** Founder
**Status:** Open
