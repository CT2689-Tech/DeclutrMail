# Returning identity sign-in

Integration owner: current Codex session in isolated a4ca worktree on
codex/returning-sign-in, based on foundation main d7d23563. Independent of Brief
#940 and compatibility #939. Owns OAuth service/controller/orchestrator/exit
filters, their tests, AuthEntry and URL/CTA contracts. No migration or provider
configuration change. Scope authorized by the user's remaining journey fixes.

Returning entry requests `openid email`, online, with account choice. The
existing full Gmail connection flow retains offline consent and gmail.modify.
Signed per-flow state determines the exchange; callback queries cannot change
it. Verified authoritative Gmail/Google Mail and Google-hosted Workspace identity
can resolve existing primary or secondary ownership, including disconnected
mailboxes. Unknown accounts return to the connection permission disclosure,
retaining the paid-plan destination. Only our session and CSRF cookie are
issued. Mailbox tokens, status, scan progress, watch and active preference stay
untouched. Account controls remain reachable during unfinished setup.

Identity verification uses the existing Google auth library signature/audience/
issuer/expiry validation and requires email_verified and a Google-owned consumer
domain or signed hosted-domain claim. The existing database keys identities by
provider email; no alias merging or new subject-identity migration is introduced.
Non-hosted third-party email identity is refused because historical email
verification alone does not establish present ownership.

Primary references:
[Google identity verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[OpenID request parameters](https://developers.google.com/identity/openid-connect/reference),
[Google Mail accounts](https://gmail.googleblog.com/2010/05/google-mail-is-becoming-gmail-in-uk.html).

Verification: real Google client URL/token parser regression plus signed
controller state tests; native migrated PGlite controller → real orchestrator →
real identity lookups → JWT/session row proves a disconnected secondary signs
into its existing owner without changing failed scan/history cursor/preferences,
and an unknown identity creates no session/account. Provider signature checking
is stubbed in parser tests; no real Google OAuth authorization was performed.

Independent review found unexpected session outages were being swallowed, losing
the existing 5xx capture path; unexpected errors now reach the shared exit filter,
which preserves signed returning intent and destination. Review also identified
Google Mail suffix compatibility, now covered without alias folding. Initial
local failures were test-only absent Request headers, too-short nonce and invalid
sync fixture properties, plus optional-audience typing; these historical failures
remain recorded and were repaired without weakening assertions.

Built-in browser on the disposable synthetic stack: 390px returning sign-in
shows identity disclosure and an intent=sign-in URL preserving Settings recovery.
Unknown-account handoff shows the full Gmail disclosure and the chosen annual Pro
route. No Google account, Gmail operation, real email, or payment was used.
Browser CDP commands timed out during concurrent local compilation; native built-in
AX navigation verified both pages. Screenshot: returning-sign-in-phone.png in the
current task visualization directory. Required remote checks and rollout remain
authoritative; local UI and fake-provider proof do not certify Google consent in
production.

Final local checks: 209 focused API tests (six files) plus the final 29-test
identity-domain rerun, 18 web tests, five shared contract tests, all eight
workspace typechecks, and lint (zero errors; six existing repository warnings).
Production build passes all 45 public prerender checks and all 51 unchanged route
budgets. Added AuthEntry stories cover new/returning/signed-out/unknown/retry.
PGlite is a migrated PostgreSQL WASM fixture, not an external native PostgreSQL
server. Independent architecture/privacy/security review is clear after the two
fixes. A later local ENOSPC interrupted formatter output; this task's completed
Brief build copy was removed, formatter rerun, and build completed successfully.
