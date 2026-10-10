# Paddle sandbox rehearsal startup correction

Root owns the isolated rehearsal script, HTTP boundary regression and its workflow tunnel target. This follow-up depends on merged #924; #925 remains held until the real provider rehearsal succeeds. No production billing behavior or provider settings change is included.

The first main-only sandbox run, 38085497359, failed before any purchase. Its sanitized artifact records both fixtures initialized, zero verified webhooks and zero owned subscriptions. The temporary client token was verified revoked, its separate notification destination verified inactive, and handler/subscription cleanup verified complete. Catalog and destination reads succeeded. The financial rehearsal remains unverified; startup failure is retained as historical evidence.

Node fetch rejects port 4045 as a forbidden lockd port before sending a request. A local direct reproduction returned `bad port`. The configured fixture port and tunnel target now use 4049; signature and private-operator checks remain unchanged. Startup evidence records which HTTP boundary probe is running. The real local HTTP regression reaches a denied 403 response on the configured runtime port. Replacing that constant with 4045 makes the regression fail; restoring 4049 passes all 13 boundary tests.

API typecheck, touched lint, formatting and diff checks pass. Independent review and normal PR/queue checks are required before the new main-only sandbox run. No charged action from the failed run is retried; it created no subscription.
