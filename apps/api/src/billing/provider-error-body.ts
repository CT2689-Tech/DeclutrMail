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
 * Email addresses are redacted before the body reaches a log.
 *
 * Not theoretical: `searchCustomers` calls
 * `GET /customers?email=<address>` (paddle.adapter.ts), so a 4xx on that
 * endpoint can echo the customer's own address straight back in the
 * error `detail`. Turning on body logging without this would have put
 * customer emails into Cloud Logging as a side effect of a diagnostics
 * fix — trading one silent problem for a quieter one.
 *
 * Deliberately a blunt pattern rather than a parse: the body is
 * untrusted, arbitrarily shaped provider text, and the safe failure mode
 * is over-redaction. What remains is exactly what the line is for —
 * `code`, `detail`, the name of the missing permission.
 */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

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
 * Carries no D7 exposure: these are billing-provider error envelopes
 * (Paddle/Razorpay), which never see Gmail message data. The PII they
 * CAN echo is a request parameter — a subscription id, which the
 * surrounding log line already names, or a customer email, which is
 * redacted here (see EMAIL_PATTERN).
 */
export async function providerErrorBody(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (raw.length === 0) return '<empty>';
    // Redact BEFORE truncating. The other order lets the cut fall inside
    // an address, leaving a fragment the pattern no longer matches — a
    // partial email in a log is still an email in a log.
    const text = raw.replace(EMAIL_PATTERN, '[email]');
    return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text;
  } catch {
    return '<unreadable>';
  }
}
