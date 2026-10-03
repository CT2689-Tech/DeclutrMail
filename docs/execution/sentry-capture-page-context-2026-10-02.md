# Browser error capture context

## Evidence and repair

Encrypted Sentry read37092235003 at2026-10-03T03:09:17Z identifies the unresolved
generic browser issue as React invariant418, unhandled global onerror, seven stack
frames and zero in-app frames on release2a175851. Its last occurrence remains
2026-10-02T21:59:11Z. This establishes hydration diagnostics, not the page or cause.
The rescore issue's latest occurrence at00:50:49Z precedes the repaired worker's
00:52:37Z deployment; absence of a newer sample does not prove successful rescore.

SDK/global browser events lacked a surface after privacy scrubbing. Add a finite
capture-time page fallback before the existing scrubber. Explicit capture-site
surface wins. Dynamic sender detail paths become sender-detail; no URL, hostname,
query, fragment, entity id or mailbox content is sent. Unknown paths and unavailable
location omit the label. The encrypted read projection retains those closed labels.

The label describes the current page when Sentry captures/sends the event. Buffered
early errors replayed after navigation can describe the replay page; this is context,
not authoritative attribution to the original throw. The historical event cannot be
retrofitted and hydration remains unresolved until reproduced. No error filtering,
grouping, sample rate, consent, DSN, SDK or product behavior changes.

## Ownership, checks and limits

Root owns the lazy browser runtime/tests, encrypted projection/tests and this record.
Based on main76d23446, which includes857. No open-PR shared-file dependency. Relates
to D159. Read-only independent review cleared bounded context and privacy behavior.
Seven web runtime tests and eight projection/encryption tests passed, full repository
typecheck/lint passed (six existing warnings). Required build/budget/browser CI pending.

Local public browser smoke uses a dummy loopback Sentry DSN and no live PostHog key:
Cookies and normal public navigation remain usable. This is optional-dependency/UI
smoke, not actual provider transport or authenticated error reproduction. No live
error was intentionally generated. Production context readback and source-map proof
remain unverified. Rollback: revert PR; no data migration.
