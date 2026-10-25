# Missed Pass refund recovery could disappear after projection failure

**Caught by:** independent flow review and real PostgreSQL negative control.
**Surface:** Backlog Pass refund recovery (D117, D119, D249).
**Before:** the periodic provider sweep selected subscriptions only. A permanently missed approved Pass refund event left its grant live until expiry. Merely adding a grant sweep would still lose its candidate if revocation committed before projection failed. Concurrent separate refunds could each calculate Plus from the other uncommitted grant.
**Repair:** exact-transaction full-approval reads feed the existing projector; revocation, projection and ledger processing commit together. Every tier projection locks the workspace before reading grants/subscriptions; the standalone Pass-purchase projection now uses a transaction too.
**Evidence:** rollback/retry tests and a real two-connection PostgreSQL concurrency test. Removing the workspace read lock reproduces stale Plus after both refunds; restoring it produces Free. The old global SQL sweep also reproduced stale Plus when racing a refund; separate lock and read statements fix that reader too.
**Prevention:** keep provider reads outside the transaction, preserve terminal grant provenance, and test candidate eligibility after projection failure plus concurrent entitlement writers.
