### 2026-08-13 — Decide how a won dispute undoes a cancel we scheduled

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-13.
**Why:** When we win a chargeback dispute, the customer gets their plan back locally, but a cancel that our own enforcement sent to Paddle stays scheduled. The subscription then ends at Paddle and nothing notices. The customer can press "Keep my subscription", but only if they see it. Fixing it needs to know who scheduled the cancel, which we do not store. Founder decision 2026-08-13: after launch; it cannot happen until a chargeback is disputed and won.
**How:**
1. After launch, choose one: (a) store who scheduled the cancel (a column and a migration), (b) alert support on a won dispute with a scheduled cancel, or (c) accept it and say so here.
2. An agent builds (a) or (b) with a test, or closes this entry on (c).
**Verifies by:** A test where a won dispute either revokes our scheduled cancel or raises a support alert, or a recorded decision to accept it.
**Who:** Founder
**Status:** Open
