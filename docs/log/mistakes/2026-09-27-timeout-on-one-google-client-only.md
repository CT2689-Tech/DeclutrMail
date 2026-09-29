## 2026-09-27 — A timeout on one Google client, and two more on the same callback path without one

**PR:** #781 (fix/d108-require-gmail-scope)
**Caught by:** delta security review (orchestrator)
**What happened:** The first fix gave the sign-in service's `OAuth2Client` a 10 s ceiling, with a comment saying a stalled Google endpoint could no longer hold the callback. Both callback flows then await `users.watch`, whose client (`gmail-watch.service.ts`) refreshes a token with no ceiling, and the worker's sync client had the same gap. The comment was true only of the one construction it sat next to.
**Correct approach:** Every `OAuth2Client` in the API comes from `googleOAuthClient()`, which carries the timeout, and a spec scans `apps/api/src` and `apps/api/scripts` and fails on any direct `new OAuth2Client(`, after first proving the scan can see the factory's own.
**Rule:** Before a comment says a path is bounded, grep every construction of the client on that path, and route them all through one factory.
**Enforcement update:** `google-oauth-client.spec.ts` (the factory's timeout, and the direct-construction guard), both negative-controlled. None to hooks.
