# Mobile launch plan: web, iOS and Android together

**Status:** Founder decisions recorded 2026-10-24. Build in progress on PR #1116.
**Related:** [ADR-0047](../adr/0047-capacitor-shell-mobile-prototype.md), [ADR-0048](../adr/0048-one-swipe-grammar.md), D164, D173, D246.

How to read the evidence: **[V]** read from a primary source this session, **[S]** secondary or vendor source, **[J]** my judgment or estimate. Anything not marked is from this repo.

## 1. What we are shipping

One product on three surfaces, built to its final scope before the first store submission. There are no staged product versions. Store updates after launch (1.0.1 and so on) are release mechanics, because stores reject builds and users find bugs, not a second product tier.

Final scope:

- Every screen tuned for a phone, with one swipe grammar (ADR-0048).
- Native sign-in through the system browser, designed to converge on bearer tokens if the UI ever goes fully native.
- Billing on web, iOS and Android, with one server-side entitlement record.
- Push notifications with privacy-safe payloads.
- Native features that also earn the "more than a website" bar: haptics, biometric lock, deep links.
- Accessibility pass, offline and error states.
- Store assets, privacy labels, reviewer access, and CI-built releases.

LLM-assisted coding makes the code days, not weeks. It does not shorten review queues or the closed-test clock, and the steps that need a store console, a real device or a credential still need you.

## 2. Decisions

| Decision | Choice                                               | Notes                                                                                                                        |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Billing  | In-app purchase plus web, one entitlement record     | Mobile users can upgrade in the app. Costs store commission and a third billing path (section 4)                             |
| Push     | Yes, privacy-safe                                    | Reverses the D164 and D246 deferral. Sync ready, a Later sender returning, Brief ready. No Gmail-derived text in any payload |
| Gestures | Right Keep, left Unsubscribe, up Delete              | Every swipe only opens the preview. Archive and Later are buttons. ADR-0048                                                  |
| Sign-in  | System-browser handoff on the existing Google client | Section 5                                                                                                                    |

Still open: developer account type (individual or entity), the push credentials (Firebase and an APNs key), and the subscription provider for store purchases (section 4).

## 3. What the stores require

| Area                         | Requirement                                                                                                                                                                                           | Evidence                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple: not a website wrapper | Apps need "features, content, and UI that elevate it beyond a repackaged website" (4.2)                                                                                                               | [V] [Apple guidelines](https://developer.apple.com/app-store/review/guidelines/)                                                                                                        |
| Apple: payments              | Unlocking features requires in-app purchase (3.1.1). Outside the US storefront, buttons or links to other purchase methods are barred (3.1.1(a))                                                      | [V] same                                                                                                                                                                                |
| Apple: web purchases         | Using web-bought subscriptions in the app is allowed only if they are also sold as in-app purchases (3.1.3(b)). Selling both satisfies this                                                           | [V] same                                                                                                                                                                                |
| Apple: sign-in               | Google Sign-In as the primary login needs an equivalent privacy-preserving option (4.8), with an exemption for clients of a specific third-party service where users sign in to that service directly | [V] same. Whether DeclutrMail qualifies is a reviewer call                                                                                                                              |
| Apple: account deletion      | If the app supports account creation it must offer deletion inside the app (5.1.1(v))                                                                                                                 | [V] same                                                                                                                                                                                |
| Apple: AI and data sharing   | Disclose where personal data goes to third parties "including with third-party AI" and get explicit permission (5.1.2(i)). The app may not require push or other system permissions to work           | [V] same                                                                                                                                                                                |
| Apple: review access         | Provide a demo account, or an Apple-approved demo mode, for any login (2.1)                                                                                                                           | [V] same                                                                                                                                                                                |
| Apple: toolchain             | Uploads must be built with Xcode 26 and the iOS 26 SDK since April 28, 2026                                                                                                                           | [S] [Apple notice](https://developer.apple.com/news/upcoming-requirements/), [Capacitor note](https://capawesome.io/blog/xcode-26-requirement-for-capacitor-apps/)                      |
| Google: payments             | In-app digital goods need Play Billing. No in-app steering to outside payment                                                                                                                         | [S] [Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818) via search snippet; page not fetched                                                     |
| Google: new personal account | Closed test, at least 12 testers opted in for 14 continuous days, before production access                                                                                                            | [V] [Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465) via search; organization accounts reported exempt [S, unconfirmed]                     |
| Google: target API           | New apps and updates must target API 36 from Aug 31, 2026. The Capacitor 8 template already targets 36                                                                                                | [S] [Android requirements](https://developer.android.com/google/play/requirements/target-sdk); `apps/mobile/android/variables.gradle`                                                   |
| Google sign-in               | OAuth in embedded webviews is blocked (`disallowed_useragent`). Use the system browser with PKCE                                                                                                      | [S] [Google help](https://support.google.com/faqs/answer/12284343), [native-app guide](https://developers.google.com/identity/protocols/oauth2/native-app) via search; page not fetched |
| Redirects                    | Claimed https redirects (Universal Links, App Links) are preferred over custom schemes, which any app can claim. PKCE is required                                                                     | [S] [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) via search; table of contents only                                                                                               |
| Google OAuth verification    | `gmail.modify` is restricted, with an annual reassessment. Whether a new client in the same project needs re-verification is unconfirmed                                                              | [S] [Google verification help](https://support.google.com/cloud/answer/13463073), not read. Ask Google; it can run in parallel                                                          |

Not verified: store developer fees, exact screenshot sizes, the Data safety form fields, store commission rates (one secondary source reports Google at 10% on the first $1M plus 5% for Play Billing around October 1, 2026 [S, unverified]).

## 4. Billing

**Final shape.** Paddle and Razorpay stay for web. Apple and Google purchases are a third provider behind the same `BillingProvider` interface (`apps/api/src/billing/billing-provider.interface.ts`), feeding one entitlement record. The web already decides what a paying user may do from that record; stores become another source of events into it, not a parallel system.

In the shell, upgrade goes through the store. The web checkout and pricing links are hidden, because Apple bars links to other purchase methods outside the US storefront and Google bars in-app steering. The shell already appends `DeclutrMailShell` to the user agent so the web can tell.

**Why this is the riskiest work package.** CLAUDE.md records 11 defects in one billing PR that green CI missed. The rules that apply:

- A terminal state stays terminal; never resolve a billing race with a timestamp tiebreak.
- Provider event timestamps are not a total order.
- An independent adversarial review pass before merge.
- Webhook authentication is Tier 1. Google's real-time notifications arrive through Pub/Sub, which fits the existing OIDC verification (D229). Apple's server notifications are signed and need their own verification.

**Open decision: subscription provider.** Verify store receipts and notifications ourselves, or use a subscription service. Using one removes receipt validation and two notification verifiers from our code, at the price of a vendor, a fee, and ADR-0023's vendor guardrails (a hard cap, an alert, a watchdog). My lean is a subscription service, decided before WP3 starts. Fees and terms are unverified.

**Cost to expect:** store commission on mobile-originated revenue, store tax handling (the stores act as merchant for those sales [J]), and a third state machine to keep honest.

## 5. Sign-in

**Design:** the system browser runs the existing, verified Google flow. The server issues a short-lived, single-use code bound to a PKCE challenge, returned through a claimed https link (Universal Link on iOS, App Link on Android). The app exchanges it for a session. Sessions stay HttpOnly cookies in the WebView, with no tokens in JavaScript.

**If the product were mobile-only:** native Google authorization through the system browser, the server exchanging Google's code for the Gmail refresh token (which stays server-side as today), then issuing its own short-lived access token plus a rotating refresh token kept in the Keychain or Keystore and sent as a Bearer header, revocable per device. That is the same OAuth flow and the same one-time-code exchange. Only the session transport differs. So the exchange endpoint returns either a cookie or tokens, and a later move to a native UI is a transport change.

**Verification:** no new OAuth client is needed, so nothing new to verify unless Google says otherwise. Ask Google in parallel.

**Tier 1:** a new auth surface. Built on the draft PR; the founder reviews before merge.

## 6. Push

Events: sync ready, a Later sender returning, Brief ready (Pro only, filtered at the producer from the tier manifest, per the CLAUDE.md rule that a capability guard is a request guard and a cron has no request). Payloads carry no Gmail-derived text. Delivery through APNs and FCM; a device-token table; per-category toggles (D165). Permission is asked at a moment that makes sense, and the app works without it (Apple 5.1.2(i)).

Needs from you: a Firebase project and an APNs key.

## 7. Work packages and who does what

| Work package               | What                                                                | I can do here                                 | Needs you or the calendar                              |
| -------------------------- | ------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| WP1 Swipe grammar          | One shared hook, Triage and Senders                                 | Done, committed                               | Device check: up-swipe vs scroll, Android edge-swipe   |
| WP2 Native sign-in         | Endpoints, web and shell plumbing, tests                            | Done, committed (ADR-0049, awaiting review)   | Real-device sign-in; Google answer on verification     |
| WP3 Store billing          | Provider adapter, notifications, entitlement mapping, shell paywall | Code, tests, docs                             | Store products, sandbox purchases, provider account    |
| WP4 Push                   | Tokens, prefs, producers, delivery                                  | Code, tests, docs, migration                  | Firebase and APNs credentials                          |
| WP5 Native features and CI | Haptics, biometric lock, deep links, release pipeline               | Config, pipeline files, web association files | A Mac or CI runner for iOS; installing from TestFlight |
| WP6 Phone pass             | Render every screen, audit, fix                                     | Render, audit, fixes                          | VoiceOver and TalkBack on a device                     |
| WP7 Store materials        | Listing, privacy labels, reviewer access, notes                     | Drafts from the render and the data inventory | Console entry, submission, answering reviewers         |

## 8. Critical path

Calendar time that coding speed does not remove:

1. **Android closed test.** The 14-day clock starts when a build with working sign-in is uploaded to the closed track with 12 or more testers, unless an organization account exempts you [S, unconfirmed].
2. **App Review.** Apple: 90% of submissions within 24 hours is the only published figure; 2026 developer reports run from a day to over 10 days [S] [reports](https://www.choicely.com/tutorials/how-long-does-app-review-take). Budget two rejection cycles.
3. **Play production review** after the closed test: reported at 7 to 14+ days for a new account [S].

Estimate [J]: 6 to 9 weeks from the day sign-in works on real devices to a coordinated launch, set by the slowest store. If one store slips more than about a week past the others, release the ready channels.

Gates:

- **G1:** sign-in works end to end on a real iPhone and a real Android phone, or stop and reassess.
- **G2:** two Apple rejections under 4.2 means adding native depth, or shipping Android and web first.
- **G3 (launch +30 days):** mobile-origin activation under 0.7x web's [J] means pausing mobile investment.

## 9. Launch checklist

Adapted from the deploy-checklist skill for stores, where a release cannot be pulled back instantly.

**Before launch**

- [ ] CI green; typecheck, lint, tests, bundle budget
- [ ] Both store builds approved and held for manual release
- [ ] Sign-in verified on real devices: first sign-in, returning, sign-out, revoke
- [ ] Store purchase, restore, renewal, cancel and refund verified in sandbox on both stores
- [ ] Web-bought and store-bought entitlements both unlock the app; a user who has both is handled
- [ ] No link to the web checkout visible in the shell (checked on a free and a paid account)
- [ ] Push permission asked in context; the app works without it; no Gmail text in a payload
- [ ] Account deletion reachable and working in the shell
- [ ] AI consent surface visible to reviewers (5.1.2(i))
- [ ] Dev-only native settings removed: iOS local-network ATS exemption, Android debug cleartext
- [ ] Reviewer access path works with a fresh Google account
- [ ] Privacy labels and Data safety match `gmail-data-inventory.ts`
- [ ] Store listings reviewed for any claim you cannot source (Tier 1b)
- [ ] Support inbox and help pages ready for store traffic

**Launch day:** release iOS and Android, start the Play staged rollout at a small share, verify key flows on a store-installed build, and watch crash-free users, sign-in success and sync failures for 48 hours.

**After launch:** reply to every review in the first week, record what shipped in the changelog, and schedule the 30 and 60 day reviews.

**Rollback.** A store binary cannot be recalled. The levers are: halt the Play staged rollout, ship a web fix (reaches app users at once), or submit an expedited update. Proposed triggers [J]: crash-free users under 98% in the first 48 hours; sign-in success under 90%; any web-checkout link visible in the shell; a billing entitlement mismatch; a sync-failure spike above the web baseline.

## 10. Launch campaign

A lean version. The campaign skill needs a goal, audience, timeline and budget from you; these are assumptions. Distribution realism matters more than reach.

- **Goal [J]:** activated users, not installs. Activation is a completed first cleanup with the preview shown. Set the number once a baseline exists.
- **Audience [J]:** Gmail users with a cluttered inbox and subscription fatigue, searching for ways to unsubscribe in bulk.
- **Channels, by realism [J]:** (1) your waitlist and the web SEO pages that already compare alternatives; (2) store search, because intent is high and the category is crowded, so keywords and the first screenshots do the work; (3) a few communities where inbox cleanup is a live topic, within their rules; (4) a launch post. Skip paid acquisition until a funnel is proven.
- **Show in the screenshots:** preview before every action, undo, Protected senders, and "we never fetch or store full email contents" with the generated storage list.
- **Ratings:** ask after a successful cleanup, via the native review prompt (needs a small plugin).
- **Metrics:** installs to sign-in, sign-in to first cleanup, week-1 retention, paid conversion by origin, rating.

## 11. Mobile adoption and accessibility

**What the category does [S].** Swipe-a-card-per-sender is the norm: Triage uses a card stack ([Gizmodo](https://gizmodo.com/new-app-lets-you-clean-your-inbox-by-swiping-left-and-r-1768255716)); InboxSwipe lets users map swipes including "Unsubscribe & Delete All" ([listing](https://itsallwidgets.com/inboxswipe-clean-emails-and-reach-inbox-zero)); one review of Unroll.me on iOS describes left as unsubscribe, up as digest, right as keep. These are press and listing descriptions that may be dated; I did not test the apps. ADR-0048's map (right Keep, left Unsubscribe) matches that convention, with one difference: every swipe opens a preview first.

**Platform floors [S].** Targets at least 44 pt on iOS and 48 dp on Android, with 8 dp between targets. iOS swipe actions default to the trailing edge and a full swipe runs the first action; DeclutrMail deliberately opens a preview instead.

**Accessibility:** one UI held to its existing rules, extended with a tap alternative for every swipe (the buttons exist), VoiceOver and TalkBack passes on Triage, Senders, bottom sheets, the drawer and the tab bar, layout at 200% zoom and the largest text size, focus order in sheets and the drawer, and contrast in both themes including the status bar region. Run a written audit per screen from the screen render, then manual passes on a device. Automated scans catch only part of this.

## 12. Risks

| Risk                                 | Why                                                           | Mitigation                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Rejection under 4.2                  | The shell is a thin wrapper                                   | Native depth (haptics, biometric lock, deep links, push); reviewer notes; fall back to Android and web first |
| Reviewers cannot sign in             | Google may challenge a new device or location                 | Dedicated test account; ask Apple to approve a demo mode (2.1)                                               |
| 4.8 sign-in rule                     | Google is the only login                                      | Reviewer notes citing the third-party-service exemption; pre-submission question                             |
| Billing drift across three providers | Entitlement races, renewal and refund edge cases              | One entitlement record; terminal states stay terminal; adversarial review; sandbox matrix                    |
| Larger review surface                | Sign-in, purchases, push and AI consent are reviewed together | Reviewer notes that walk each one; budget two rejection cycles                                               |
| Gesture friction                     | Up-swipe vs scroll; Android edge-swipe back                   | Device test; per-verb counts to confirm the frequency hypothesis                                             |
| OAuth re-verification                | A new consent logo or client could reopen review              | Reuse the verified client; ask Google now, in parallel                                                       |
| Solo bandwidth                       | Three channels, two review queues                             | Gates G1 and G2; the CI pipeline so your part is installing and testing                                      |

## 13. Needed from you

1. **Account type:** individual or entity for both stores. This sets the seller name, and for Play whether the 14-day test applies.
2. **Credentials:** a Firebase project and an APNs key for push.
3. **Subscription provider** for store purchases (section 4), or approval of my lean toward a subscription service.
4. **Targets:** a first-30-days activation goal and a monthly budget.
5. **Hands:** a Mac or CI runner for iOS builds, and real devices for the checks marked above.
