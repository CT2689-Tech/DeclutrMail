# Autopilot streamed-query hydration

A direct production Autopilot load emitted React418 while subsequently rendering
five inactive rules and zero pending suggestions. The encrypted production-only
Sentry collector retained the same error classification and capture-time surface.
This observation does not identify the originating component.

A deterministic regression using the installed React and TanStack libraries
exposes a specific bridge defect: a pending server snapshot renders loading markup,
but a synchronously fulfilled Flight-style thenable promotes that query to success
before the first client render. Real renderToString and hydrateRoot report a
recoverable markup mismatch. That regression failed with the original boundary.

For streamed snapshots only, the bridge now normalizes pending thenables into
native promises before handing them to TanStack. Their asynchronous callbacks
preserve the pending snapshot on the first boundary render and still adopt the
same server result. Successful snapshots and regular non-streamed routes retain
the existing path. There is no new fetch, deadline, data collection, auth policy,
error suppression, rule activation or provider mutation.

## Scope and verification

This audit session owns and integrates the shared server bridge, the small client
boundary, four regression cases, the Autopilot hydration smoke assertion and this record. No unmerged dependency; base
includes the Activity and finance repairs. Autopilot is the sole current streaming
caller. Its query-consuming content has no descendant Suspense boundary. This
repair does not claim to protect arbitrary deferred descendant hydration; that
would require separate coverage and design if such a consumer is introduced.

Twenty-seven focused tests pass: fulfilled-before-client and unresolved-after-client
controls, settled/newer-cache data, rejected transport, and existing Autopilot
cache adoption, deadlines and recovery/SSR tests. Rejected-control retries are
explicitly disabled so its assertion concerns the transported rejection, while
existing feature tests retain the application's recovery behavior.

An isolated synthetic account with five inactive rules and no pending suggestions
renders meaningful content and reloads without captured hydration errors on the
candidate development build. Optional-read and JavaScript delays were confined to
the temporary stack copy and are not committed. The old synthetic route also
rendered cleanly under that control, so this is browser smoke, not proof that the
production event has the same cause. No rule was enabled; no worker runs here.

The browser smoke now waits for the Rules heading and completion of rule, pending
and pattern loading states before evaluating captured hydration errors; a nonempty
body alone is insufficient. That strengthened CI browser assertion is pending.

Production attribution and resolution remain pending deployment verification.
Keep the runtime finding open until direct load/reload and meaningful navigation
on the deployed candidate no longer reproduce the observed error.
