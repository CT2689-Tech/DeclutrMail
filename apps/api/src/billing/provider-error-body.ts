// apps/api/src/billing/provider-error-body.ts — the provider's own
// explanation for a failed billing API call, trimmed for a log line.
//
// Both adapters used to log `status=${res.status}` and discard the body.
// That is what a 403 on Paddle's `GET /adjustments` looked like for
// eleven days (2026-08-14 → 2026-08-25): 1,223 identical lines, each
// naming a status code that could mean a missing permission, a revoked
// key, a wrong environment, or a blocked account. Paddle's body said
// which one in a single sentence, and we threw it away on every line.
//
// A refund had settled the whole time; the settlement read was the only
// call the key could not make, so the customer held no plan and could
// not repurchase. Diagnosing it needed a hand-run `curl`, because the
// logs recorded the failure without recording the reason.
//
// The old comment at the Paddle cancel site stated the rationale
// outright — "log status only … keep the line lean". Leanness on an
// error path is not economy, it is the deletion of the one fact the
// line exists to carry.

/**
 * Upper bound on logged body text. Provider error envelopes are a few
 * hundred bytes; the cap exists so a proxy's HTML error page cannot
 * flood a log line, not because the provider is expected to be verbose.
 */
const MAX_BODY_CHARS = 300;

/**
 * Read a failed `Response`'s body as log-safe text.
 *
 * Never throws — every failure mode returns a marker instead, because
 * this is called from error paths that are already reporting a problem
 * and must not acquire a second one. `res.text()` rejects on a consumed
 * or aborted stream, and an error path that itself threw would replace
 * a diagnosable provider failure with an opaque one.
 *
 * Call it BEFORE `res.json()` on the same response — a body can only be
 * read once. Every current caller is in an `if (!res.ok)` branch that
 * returns or throws, so none reads the body afterwards.
 *
 * Not a privacy surface under D7: these are billing-provider error
 * envelopes (Paddle/Razorpay), which carry no Gmail message data of any
 * kind. They can echo a request parameter such as a subscription id,
 * which the surrounding log line already names.
 */
export async function providerErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (text.length === 0) return '<empty>';
    return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text;
  } catch {
    return '<unreadable>';
  }
}
