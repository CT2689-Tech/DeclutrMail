/**
 * Most sender ids one `POST /api/triage/explain` may carry.
 *
 * The page asks for the sentences behind every Triage row still on the
 * template in ONE request, so the endpoint's ceiling and the page's batch
 * size have to be the same number. Held here, where both apps read it, so
 * lowering one cannot make the other's full-queue ask a 400 that the page
 * swallows by design — the shape of a guard that fails silently.
 */
export const EXPLAIN_BATCH_MAX = 12;
