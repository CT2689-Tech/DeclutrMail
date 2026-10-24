# ADR-0049: System-browser sign-in handoff for the native app

- **Status:** Proposed 2026-10-24 — **founder review required (Tier 1: auth surface, session issuance)**
- **Date:** 2026-10-24
- **Deciders:** chintan.a.thakkar@gmail.com (to ratify); Claude (author)
- **Related D-decisions:** D4, D155, D173, D205, D229
- **Related ADRs:** ADR-0047 (Capacitor shell), ADR-0048

## Context

The native app is a Capacitor shell whose WebView loads the web app (ADR-0047).
Two facts block sign-in there:

1. Google rejects OAuth in an embedded WebView (`disallowed_useragent`), so the
   existing "Continue with Google" navigation cannot run inside the shell.
2. Session cookies (`dm_access`, `dm_refresh`, `dm_csrf`) are host cookies. A
   session created in the system browser is invisible to the WebView, and there
   is no bearer-token path to hand one over (`JwtGuard` reads cookies only).

The same two facts apply to every authenticated Gmail connect, reconnect and
reactivate: they start in the app and must finish in a browser.

## Decision

The system browser runs the **existing** Google flow on the **existing** OAuth
client. It never receives a session. The flow ends with a one-time code that
only the app holding the PKCE verifier can redeem for its own session.

```
app                          system browser                     API
 | verifier, challenge=S256(verifier)
 | open  /auth/google/native/start?challenge=…  ───────────────►  state cookie (challenge inside)
 |                               ◄──── Google consent ─────────►  callback: identity resolved,
 |                                                                session row S created, NO cookie;
 |                                                                ticket(hash(code), challenge, S, returnTo)
 |                               ◄──── page: com.declutrmail.app://auth/return?code=<code>
 | appUrlOpen(code)
 | POST /auth/native/exchange {code, verifier}  ───────────────►  DELETE ticket RETURNING; check S256;
 | ◄── Set-Cookie dm_* , { returnTo }                             re-mint S's tokens (jti and refresh
 |                                                                hash replaced); cookies in the WebView
```

Gmail connect from a signed-in app: `POST /auth/google/native/connect-ticket`
(JWT + CSRF + the same `InboxLimitGuard` and target validation as the browser
route) returns a single-use URL; the browser opens it with no cookies, the
ticket stands in for the app's session, and the existing authenticated consent
runs. It ends in a return that only navigates.

Every other exit of a native flow (cancelled consent, unknown account, beta
gate, inbox limit, a thrown error and its exit filter) is a redirect into the
web app. For a native flow those redirects are translated once, in
`native-exit.ts`, into a return `com.declutrmail.app://auth/return?to=<path>`
that navigates the WebView to the page the web would have shown. Redirects
elsewhere (Google) pass through.

### Contract and surface

| Piece                       | Where                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| Link, PKCE and wire schemas | `packages/shared/src/contracts/native-auth.ts`                                  |
| Tickets                     | `native_auth_tickets` (migration 0098), `NativeAuthService`                     |
| Browser leg                 | `GoogleOAuthController`: `native/start`, `native/open`, `native/connect-ticket` |
| App leg                     | `NativeAuthController`: `POST /auth/native/exchange`                            |
| Session re-mint             | `SessionsService.issueForHandoff`                                               |
| Shell                       | `apps/web/src/lib/native/*`, diverts OAuth links and handles the return         |
| Identity                    | `com.declutrmail.app` is the bundle id, the application id and the scheme       |

### Properties the design relies on

- **No credential in the browser.** The callback sets no cookie in a native
  flow. The return page carries a code or a path, never a token.
- **The table holds nothing redeemable.** Only `sha256(code)` is stored, plus
  ids, the PKCE challenge and an app path. No token, no Gmail data. It is not in
  the Gmail data inventory for the same reason `active_sessions` is not.
- **Single use.** Redemption is one `DELETE … RETURNING` (a replay and a race
  both find nothing). TTLs: 60 s for a handoff, 5 min for a connect ticket.
- **A wrong verifier burns the code.** A holder of the code without the verifier
  gets one guess, not a free one.
- **The destination is server-decided.** `returnTo` is stored with the ticket
  from the same computation the web uses; the link never carries it.
- **Cascade.** Account deletion (D232) and a revoked session take open tickets
  with them. Redeeming rotates the session's jti and refresh hash under a row
  lock, so the pair minted at callback time (which went nowhere) is dead.
- **The app honors a return only while it has a flow pending.** Any app or web
  page can fire the scheme; a stray link signs nobody in and moves nobody.

### Threat model

| Attack                                                    | Defense                                                                                                    | Test                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Another app on the device intercepts the return link      | The code is useless without the verifier, which never leaves the app                                       | wrong verifier burns the code   |
| Replay of a code                                          | Single-use delete                                                                                          | replay is refused               |
| Expired code                                              | `expires_at` in the delete's predicate                                                                     | expired code refused            |
| Cross-site form post signs the visitor in as someone else | Exchange requires `application/json`; a JSON POST needs a CORS preflight and only the web origin passes it | form post refused, code unspent |
| A 401 from exchange restarts the failed flow              | Every refusal is a 400; the web client's 401 path refreshes then redirects to login                        | all refusals are 400            |
| Handoff code used as a connect ticket, or the reverse     | `kind` is part of the delete's predicate                                                                   | kinds do not cross              |
| Session revoked between callback and redeem               | `issueForHandoff` checks `is_revoked` under lock                                                           | session-gone refused            |
| Stray `to=` link navigates the app                        | Pending-flow gate in the shell; same-origin path only                                                      | no flow, no navigation          |
| Connect ticket for a revoked app session                  | Live session check at `native/open`                                                                        | session-retry result            |

### What this does not change

No new OAuth client, no scope change, no change to token storage, and none of
the web flow: the web callback, cookies and redirects are byte-identical when a
state carries no native field (345 existing auth tests pass unmodified apart
from one constructor argument).

## Alternatives considered

- **Native Google Sign-In SDK.** Needs a new iOS and Android OAuth client,
  server-side verification of a second token type, and native code that cannot
  be compiled in this repo's CI. It also would not remove the need for a Gmail
  authorization-code flow for the refresh token. Rejected for now.
- **Bearer tokens for the app.** A second authentication path through every
  guard and the CSRF model. Rejected.
- **Embedded WebView OAuth.** Blocked by Google.
- **Return by claimed `https` link (Universal Links / App Links).** The stronger
  form: the OS routes only to the verified app, which removes scheme squatting
  and the iOS "Open in app?" prompt. It needs the association files hosted on
  the web domain and the app's signing identity, both WP5. The custom scheme
  stays as the fallback; the contract's `parseNativeReturnUrl` is the one place
  to extend.

## Consequences

### Positive

- One OAuth client, one callback, one place where identity is resolved.
- Mobile cannot weaken the web: every protection above is exercised over real
  HTTP, and each was removed in turn to confirm a test fails.

### Negative

- A session row exists from callback to redeem with tokens no one holds. If the
  app never redeems, it is an unused live session, like any abandoned browser
  sign-in. The next stage sweeps expired tickets, not their sessions.
- `native/start` is a public route that creates state (a signed cookie) like
  `start` does. It shares the `auth` rate-limit bucket.
- The custom scheme is the weaker transport until WP5 adds claimed links. An
  app that registers the same scheme sees a code it cannot use; one that also
  drives the sign-in start can only complete a flow the person signs in to,
  which is phishing, not interception.

## Not verified here (no Xcode or Android toolchain in this environment)

Each needs a device before release; none is covered by an automated test:

1. SFSafariViewController and Chrome Custom Tabs open `com.declutrmail.app://`
   from the return page, and whether the page's automatic refresh or only the
   button does it (the button is the guaranteed path).
2. `@capacitor/browser` and `@capacitor/app`, imported by the remote web page,
   reach their native plugins in a `server.url` shell.
3. A fetch from the WebView stores the cookies the exchange sets (WKWebView and
   Android WebView, `SameSite=Strict` refresh cookie).
4. A cold start from the return link (the OS reclaimed the app while the browser
   was open) redeems the code from `getLaunchUrl`.
5. Android: back from the Custom Tab, and a second tap on the return button.

## References

- RFC 8252 (OAuth for native apps), RFC 7636 (PKCE)
- `docs/execution/mobile-launch-plan-2026-10-24.md`
- `apps/api/src/auth/native-sign-in.http.spec.ts`
