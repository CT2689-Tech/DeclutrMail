# Signed-out onboarding session probe — 2026-10-26

Relates to D107 and D108. Integration owner: this session. The change owns the
onboarding page, its public session probe, and a focused navigation regression
test. It has no dependency on another open PR or shared API contract change.

## Cause and fix

The public Promise and Connect screens called the protected `useMe()` query.
After `/api/auth/me` and refresh both returned 401, the shared API client
redirected to returning sign-in before the page could render its anonymous
branch. The server boundary already allowed an anonymous visitor.

The public route now uses its own session query with the terminal 401 redirect
suppressed. It renders the public Promise while an unknown session is being
checked, so that entry does not depend on a loading spinner resolving. It
reuses the server-seeded identity for signed-in visitors. The protected
secondary-mailbox route and the authenticated flow still use `AuthProvider`
and its normal expired-session redirect.

## Verification

- Regression reproduced before the fix: an anonymous render assigned
  `/sign-in?returning=1&returnTo=%2Fonboarding`.
- Focused tests after the fix: 76 passed across onboarding page/navigation,
  shared session-observer, and API-client suites. The new test also verifies
  that secondary-mailbox entry retains its protected redirect.
- In Codex's built-in browser against a disposable local Postgres/Redis stack,
  desktop `/onboarding` stayed on the Promise screen and advanced to Connect.
  At 320px, Connect had no horizontal overflow (`scrollWidth` 310, viewport
  320). No Google consent or real mailbox was accessed.
- The final production web build, served with the disposable local API on a
  fresh loopback origin, also showed Promise immediately and advanced to
  Connect while auth and refresh returned 401. At 320px, the production
  Connect step had no horizontal overflow (`scrollWidth` 310, viewport 320).
- The same browser used the stack's allowlisted synthetic dev login. At 320px,
  the signed-in setup advanced from goal choice to first sender review, then
  Finish review opened Cleanup. First review had no horizontal overflow
  (`scrollWidth` 320). The disposable database recorded onboarding completion;
  mail message and action-job counts remained 3 and 50.
- The final focused suite passed (76 tests), web typecheck, lint, formatting,
  production build, bundle budget and prerender checks passed.

This browser pass covers the app-owned steps with synthetic data, not Google's
consent screen, a real initial scan, or production OAuth.
