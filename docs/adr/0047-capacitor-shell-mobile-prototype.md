# ADR-0047: Capacitor remote-URL shell for the mobile prototype

- **Status:** Accepted 2026-10-24 — the shell is the basis of the final app (see Amendment)
- **Date:** 2026-10-24
- **Deciders:** chintan.a.thakkar@gmail.com (to ratify); Claude (author)
- **Related D-decisions:** D164, D173, D246
- **Related ADRs:** ADR-0018 (phone dialect; rejects native as out of scope), ADR-0048 (swipe grammar)

## Context

D164, D173 and D246 defer native mobile and native push until demand justifies
them. The founder asked for a prototype first, to see the app on a phone before
deciding anything else.

D173 assumed a React Native app would reuse business hooks from
`packages/shared/hooks` (estimated 3–5 days). Measured 2026-10-24, that is no
longer true: `packages/shared/src/hooks` holds six UI hooks, while the 69 data
hooks and the API client live in `apps/web`, and the client reads
`document.cookie`. 162 of 502 feature files touch `next/*` or DOM globals, over
roughly 95k lines. A React Native app is a second UI, not a refactor.

Auth is cookie-only: `JwtGuard` reads the `dm_access` cookie, `CsrfGuard` checks a
double-submit cookie, and there is no bearer path.

## Decision

The prototype is a Capacitor shell, `apps/mobile`, whose WebView loads the
existing web app from a configured `CAP_SERVER_URL`. It bundles no web code, adds
no native plugins, and adds no API surface. The one web change it forces is a top
safe-area inset on `.dm-app-viewport` and the navigation drawer, which is a no-op
in every ordinary browser.

## Alternatives considered

- **React Native / Expo (D173's plan):** rejected for the prototype — a second
  UI over ~95k lines, and a permanent doubling of the gate and QA surface.
- **Bundle a static export in the shell:** rejected — the app renders per
  request and sets a per-request CSP nonce in middleware, so it cannot be
  exported.
- **Installable PWA only:** not rejected, only insufficient — it does not answer
  the store-shell questions. It stays available independently.

## Consequences

### Positive

- One UI, one codebase; a phone prototype in days.
- Every web fix reaches the shell with no second release path.

### Negative

- The shell behaves like a browser. Apple's minimum-functionality review (4.2) is
  a known risk for a wrapper with little native behavior.
- Sign-in does not work in the shell (see below), so the prototype is reached
  through the dev test-login only.

### Neutral

- `appId` was the placeholder `com.declutrmail.proto`. It is now `com.declutrmail.app`
  (the sign-in return scheme too, ADR-0049); the bundle id cannot change after the
  first store upload.

## Not decided here (Tier 1 — founder first)

- **Native sign-in.** Google rejects OAuth in embedded webviews, and the session
  cookies are HttpOnly host cookies, so a system-browser sign-in cannot reach the
  WebView. Needs a handoff design (new auth surface).
- **Billing.** Store rules for in-app subscriptions versus the Paddle/Razorpay
  web checkout (ADR-0023, 0035, 0044). The shell currently shows the web's
  upgrade UI.
- **Push** (D164, D246), **store privacy labels** generated from
  `gmail-data-inventory.ts` (Tier 1b), and CSP/CORS if the shell's origin changes.

## Implementation notes

- Dev-only native settings to remove before any store build: iOS
  `NSAppTransportSecurity` / `NSLocalNetworkUsageDescription`
  (`ios/App/App/Info.plist`) and `android/app/src/debug/AndroidManifest.xml`.
- Portrait is locked on iPhone and Android because the web handles only the top
  and bottom insets, not landscape side cutouts.
- Not yet inset-checked: the no-active-mailbox gate and `/onboarding`.
- Default Capacitor icon and splash remain; brand assets need the size-specific
  logo cuts in ADR-0036.

## References

- `apps/mobile/README.md`
- `docs/log/learnings/2026-10-24-d173-mobile-reuse-premise-stale.md`
- `docs/log/founder-followups/2026-10-24-native-app-tier1-decisions.md`

## Amendment (2026-10-24)

The founder chose to launch web, iOS and Android together as one final scope, not
a prototype followed by later versions. The Capacitor shell is therefore the basis
of the shipped app, and ADR-0047 no longer means "prototype only".

The items listed above as not decided are now decided; each gets its own ADR as
its work package lands:

- **Billing:** in-app purchase plus web, one entitlement record.
- **Push:** yes, with privacy-safe payloads. This reverses D164 and D246.
- **Gestures:** ADR-0048.
- **Sign-in:** a PKCE-bound system-browser handoff on the existing Google client
  (ADR-0049, proposed, awaiting founder review).

Still true: this ADR does not decide store privacy labels (generated from
`gmail-data-inventory.ts`, Tier 1b) or CSP and CORS changes, and the dev-only
native settings must be removed before any store build. See
`docs/execution/mobile-launch-plan-2026-10-24.md`.
