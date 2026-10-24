# Mobile launch plan: web + iOS + Android

**Status:** Proposal for the founder. Items marked **Tier 1** need your decision before any code (CLAUDE.md §2.0).
**Date:** 2026-10-24
**Related:** [ADR-0047](../adr/0047-capacitor-shell-mobile-prototype.md), D164, D173, D246, PR #1116 (the prototype shell).

How to read the evidence: **[V]** read from a primary source this session, **[S]** secondary or vendor source, **[J]** my judgment or estimate. Anything not marked is from this repo.

## 1. Summary

1. **Launch all three together, but gate the date on approvals, not the calendar.** Prepare web, iOS and Android, hold both store builds at "approved, not released", then release on one day. Do not set the date first.
2. **Android is probably the long pole.** A new personal Play account needs a closed test with at least 12 testers for 14 continuous days before it can apply for production [V]. That clock cannot start until the shell can sign in.
3. **Ship v1 as a free companion app with no purchasing inside it.** Apple's rule 3.1.3(f) exempts free companion apps to paid web tools for Email Services from in-app purchase, if the app has no purchasing and no call to action to buy elsewhere [V]. This avoids a third billing provider, but mobile-originated users cannot upgrade in the app. Section 4 prices that trade-off.
4. **Four blockers decide whether this ships at all:** native sign-in, Apple's "more than a repackaged website" rule (4.2), reviewer access to a Google-sign-in app, and the billing model. None is UI work.
5. **Expect 7 to 9 weeks to a coordinated launch** [J], dominated by waiting (Play's 14 days, review queues), not by engineering.

## 2. Is a simultaneous launch the right call?

Mostly yes, with one change.

- **For:** one announcement, one set of screenshots, one support moment. Web is the safety net: a web fix reaches every app user at once because the shell loads the site.
- **Against:** a triple launch gives you three ways to slip. Apple review has no committed time beyond "90% within 24 hours", and 2026 developer reports run from a day to over 10 days [S]. Play review for a new account is reported at 7 to 14+ days [S].
- **The change:** if one store slips more than about a week past the others, release the ready channels and let the third follow. Do not hold three channels hostage to one.

Release mechanics (hold an approved build, then release on a chosen day) exist on both stores [J, confirm in each console].

## 3. What the stores require

| Area                         | Requirement                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple: not a website wrapper | Apps need "features, content, and UI that elevate it beyond a repackaged website" (4.2)                                                                                                                                     | [V] [Apple guidelines](https://developer.apple.com/app-store/review/guidelines/)                                                                                                        |
| Apple: payments              | Unlocking features requires in-app purchase (3.1.1). Buttons or links to other purchase methods are barred outside the US storefront and a few entitlement regions (3.1.1(a))                                               | [V] same                                                                                                                                                                                |
| Apple: web purchases         | Using web-bought subscriptions in the app is allowed only if they are also sold as in-app purchases (3.1.3(b))                                                                                                              | [V] same                                                                                                                                                                                |
| Apple: companion exemption   | Free companion apps to a paid web tool for Email Services need no in-app purchase if there is no purchasing and no call to action to buy outside the app (3.1.3(f))                                                         | [V] same                                                                                                                                                                                |
| Apple: sign-in               | An app using Google Sign-In as its primary login must also offer an equivalent privacy-preserving login (4.8), with an exemption for clients of a specific third-party service where users sign in to that service directly | [V] same. Whether DeclutrMail qualifies is a reviewer call                                                                                                                              |
| Apple: account deletion      | If the app supports account creation it must offer deletion inside the app (5.1.1(v))                                                                                                                                       | [V] same                                                                                                                                                                                |
| Apple: AI and data sharing   | Disclose where personal data goes to third parties "including with third-party AI" and get explicit permission (5.1.2(i))                                                                                                   | [V] same                                                                                                                                                                                |
| Apple: review access         | Provide a demo account, or an Apple-approved demo mode, for any login (2.1)                                                                                                                                                 | [V] same                                                                                                                                                                                |
| Apple: toolchain             | Uploads must be built with Xcode 26 and the iOS 26 SDK since April 28, 2026                                                                                                                                                 | [S] [Apple notice](https://developer.apple.com/news/upcoming-requirements/), [Capacitor note](https://capawesome.io/blog/xcode-26-requirement-for-capacitor-apps/)                      |
| Google: payments             | In-app digital goods need Play Billing. No in-app steering to outside payment. Apps that only let people use what they bought elsewhere may mention purchase options without direct links                                   | [S] [Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818) via search snippet; page not fetched                                                     |
| Google: new personal account | Closed test, at least 12 testers opted in for 14 continuous days, before production access                                                                                                                                  | [V] [Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465) via search; organization accounts reported exempt [S, unconfirmed]                     |
| Google: target API           | New apps and updates must target API 36 from Aug 31, 2026. The Capacitor 8 template already targets 36                                                                                                                      | [S] [Android requirements](https://developer.android.com/google/play/requirements/target-sdk); `apps/mobile/android/variables.gradle`                                                   |
| Google sign-in               | OAuth in embedded webviews is blocked (`disallowed_useragent`). Use the system browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android) with PKCE                                                                | [S] [Google help](https://support.google.com/faqs/answer/12284343), [native-app guide](https://developers.google.com/identity/protocols/oauth2/native-app) via search; page not fetched |
| Google OAuth verification    | `gmail.modify` is a restricted scope with an annual security reassessment. Vendor cost figures conflict by more than an order of magnitude                                                                                  | [S] [Nylas](https://www.nylas.com/?p=1231), [Unipile](https://www.unipile.com/integrating-google-oauth-2-0-user-authentication-into-your-app/). Get a quote from your assessor          |

Not verified at all: store developer fees (Apple annual, Google one-time), the exact screenshot sizes each store requires today, and Google Play's Data safety form fields. Check each console.

## 4. Billing model for v1

**Recommendation: free companion app, no purchase UI, no purchase calls to action** [J, on the sources above].

What it means in practice:

- Hide every upgrade surface when running in the shell: pricing links, "Compare plans", upgrade modals, quota upsells, locked-feature prompts. The shell already appends `DeclutrMailShell` to the user agent, so the web can detect it.
- Paying users sign in and get their entitlements. Free users see a free product.
- Do not change this after approval. Adding upgrade prompts later to an approved build breaks the exemption.

**The cost, stated plainly.** A user who installs from a store, hits a free-tier limit and cannot upgrade in the app leaks. They convert only if they go to the web on their own. This is the biggest monetization risk in the plan, not a footnote.

**Why not in-app purchase first.** It adds a third billing provider next to Paddle and Razorpay, plus subscription state reconciliation. CLAUDE.md already records 11 defects in one billing PR that green CI missed. Store commission rates are also moving: one secondary source reports Google at 10% on the first $1M plus 5% for Play Billing, effective around the US fee date of October 1, 2026 [S, unverified]; Apple's US link-out rules are still being litigated.

**Gate to revisit** [J]: after 60 days, if mobile makes up 30% or more of signups and mobile-origin paid conversion is under a third of web's, scope in-app purchase. Accept the commission only against that data.

**Tier 1 decisions this needs:** billing presentation state in the shell (ADR-0027), and what a locked feature shows with no price and no link.

## 5. Adopting the product to mobile

**What the category does.** Swipe-a-card-per-sender is the norm [S]: Triage uses a card stack ([Gizmodo](https://gizmodo.com/new-app-lets-you-clean-your-inbox-by-swiping-left-and-r-1768255716)); InboxSwipe lets users map swipes to actions including "Unsubscribe & Delete All" ([listing](https://itsallwidgets.com/inboxswipe-clean-emails-and-reach-inbox-zero)); one review of Unroll.me on iOS describes left swipe as unsubscribe, up as digest, right as keep. These are press and app-store descriptions that may be dated, and I did not test the apps.

**Where DeclutrMail should differ.** Competitors put destructive verbs on a swipe. DeclutrMail's Triage keeps Unsubscribe and Delete button-only, and every swipe opens a preview. Keep that. It is a trust position, not a limitation.

**Platform floors.** Targets of at least 44 pt on iOS and 48 dp on Android, with 8 dp between targets [S]. iOS swipe actions default to the trailing edge and a full swipe runs the first action; DeclutrMail deliberately opens a preview instead.

**Rules to adopt** (from the earlier discussion, all [J]):

1. One gesture grammar on every screen. Triage's: right Keep, left Archive, up Later, tap to expand, long-press to select. Senders currently differs (founder decision).
2. Tap is the main path, swipe the shortcut. Every swipe has a visible button, at least 44 px, near the bottom of the screen.
3. Swipe, then a one-tap preview sheet, then an undo toast. No second confirm.
4. No destructive verb on a gesture.

## 6. Plan, with gates

Estimates are [J]. Week 0 is the day you approve the Tier 1 decisions.

| Phase                     | Weeks          | Work                                                                                                                                                                                                                                                                                                                                                                                                           | Gate                                                                                                                          |
| ------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **0. Decide and enroll**  | 0 to 1         | Tier 1 decisions (sign-in handoff, billing model, account type). Enroll Apple Developer and Google Play. Pull the phone-session share from PostHog. Finish the screen-by-screen phone audit.                                                                                                                                                                                                                   | **G0:** phone share and intent justify stores. Default [J]: under about 20% of authed sessions, stay web/PWA and defer stores |
| **1. Make it a real app** | 1 to 3         | Native sign-in handoff on the existing server OAuth flow (new client types would trigger re-verification, so avoid them). Shell-aware billing gating. Phone pass on Triage, Senders, Home. Native features for 4.2: haptics on verbs, biometric app lock, deep links from the sync-ready email (needs `apple-app-site-association` and `assetlinks.json` on the web). Account deletion reachable in the shell. | **G1:** sign-in works end to end on a real iPhone and a real Android phone. If not, stop and reassess                         |
| **2. Beta**               | 3 to 5         | TestFlight (external testers need Beta App Review). Upload to Play closed test and start the 14-day clock with 20+ testers. Store assets. Privacy labels and Data safety generated from `gmail-data-inventory.ts` (Tier 1b). Reviewer access path. Mobile release check on both projects.                                                                                                                      | Crash-free and sign-in success thresholds in section 7                                                                        |
| **3. Submit**             | 5 to 7         | Submit iOS with manual release. Apply for Play production when day 14 passes. Budget two rejection cycles.                                                                                                                                                                                                                                                                                                     | **G2:** two 4.2 rejections means add native depth or ship Android and web first                                               |
| **4. Launch day**         | 7 to 9         | Release both builds and web together. Staged rollout on Play. Watch the dashboards for the first 48 hours.                                                                                                                                                                                                                                                                                                     | Section 7 rollback triggers                                                                                                   |
| **5. Learn**              | +30 / +60 days | Funnel review. IAP gate (section 4). Push (D164, D246) only if retention warrants it.                                                                                                                                                                                                                                                                                                                          | **G3:** if mobile-origin activation is under 0.7x web's at 30 days [J], pause mobile investment                               |

## 7. Launch checklist

Adapted from the deploy-checklist skill for stores, where a release cannot be pulled back instantly.

**Pre-launch**

- [ ] CI green; typecheck, lint, tests, bundle budget
- [ ] Both store builds approved and held for manual release
- [ ] Sign-in verified on real devices: first sign-in, returning, sign-out, revoke
- [ ] Shell hides every purchase surface and link (checked on a free and a paid account)
- [ ] Account deletion reachable and working in the shell
- [ ] AI consent surface visible to reviewers (5.1.2(i))
- [ ] Dev-only native settings removed: iOS local-network ATS exemption, Android debug cleartext
- [ ] Reviewer access path works with a fresh Google account
- [ ] Privacy labels and Data safety match `gmail-data-inventory.ts`
- [ ] Store listings reviewed for any claim you cannot source (Tier 1b)
- [ ] Support inbox and help pages ready for store traffic
- [ ] Rollback plan below agreed in writing

**Launch day**

- [ ] Release iOS and Android; start the Play staged rollout at a small share
- [ ] Verify the key flows on a store-installed build, not a debug build
- [ ] Watch crash-free users, sign-in success and sync failures for 48 hours

**Post-launch**

- [ ] Reply to every review in the first week
- [ ] Record what shipped in the changelog
- [ ] Schedule the 30 and 60 day reviews

**Rollback.** A store binary cannot be recalled, so the levers are: halt the Play staged rollout, ship a web fix (reaches app users at once), or submit an expedited update. Proposed triggers [J]: crash-free users under 98% in the first 48 hours; sign-in success under 90%; any purchase surface visible in the shell; any sync-failure spike above your current web baseline.

## 8. Launch campaign

This is a lean version. The campaign skill needs a goal, audience, timeline and budget from you; I have used assumptions marked [J]. Distribution realism matters more than reach.

- **Goal [J]:** activated users, not installs. Define activation as a completed first cleanup with the preview shown. Set the number after the baseline exists.
- **Audience [J]:** Gmail users with a cluttered inbox and subscription fatigue, searching for ways to unsubscribe in bulk.
- **Channels, by realism [J]:** (1) your existing waitlist and the web SEO pages, which already compare alternatives; (2) store search, because intent is high and the category is crowded, so keywords and the first screenshots do the work; (3) a few communities where inbox cleanup is a live topic, within their rules; (4) a launch post. Skip paid acquisition until a funnel is proven.
- **Differentiators to show in screenshots:** preview before every action, undo, Protected senders, "we never fetch or store full email contents" with the generated storage list.
- **Ratings:** ask for a review after a successful cleanup with undo unused, via the native review prompt (needs a small plugin).
- **Metrics:** installs to sign-in, sign-in to first cleanup, week-1 retention, paid conversion on web for mobile-origin users, rating.

## 9. Accessibility on mobile

Do not build a separate accessible layout; hold the one UI to the rules it already has (44 px targets, reduced motion, inset handling) and extend them:

- A tap alternative for every swipe, announced to screen readers
- VoiceOver and TalkBack passes on Triage, Senders, bottom sheets, the drawer, and the tab bar
- Layout at 200% zoom and at the largest text size
- Focus order inside sheets and the drawer
- Contrast in both themes, including the status bar region

Run a written audit per screen from the screen render, then manual VoiceOver and TalkBack passes. Automated scans catch only part of this.

## 10. Risks

| Risk                     | Why                                              | Mitigation                                                                                      |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Rejection under 4.2      | The shell is a thin wrapper                      | Native depth in phase 1; reviewer notes; fall back to Android and web first                     |
| Reviewers cannot sign in | Google may challenge a new device or location    | Provide a dedicated test account; ask Apple to approve a demo mode (2.1)                        |
| 4.8 sign-in rule         | Google is the only login                         | Reviewer notes citing the third-party-service exemption; confirm with a pre-submission question |
| Conversion leak          | No in-app upgrade                                | Section 4 gate; web upgrade email path for mobile users                                         |
| OAuth re-verification    | A new consent logo or client could reopen review | Reuse the verified web client; ask your assessor before changing branding                       |
| Solo bandwidth           | Three channels, two review queues                | Gate G0 and G1 before spending phase 2 time                                                     |
| Billing drift            | Policy text changes under you                    | Re-read both billing policies the week before submission                                        |

## 11. Decisions needed from you

1. **Sign-in handoff** (Tier 1): approve a one-time-code handoff on the existing server flow.
2. **Billing** (Tier 1): confirm the free companion model for v1, and what a locked feature shows.
3. **Account type:** individual or entity for both stores. This sets the seller name, and for Play whether the 14-day test applies.
4. **Gesture grammar:** Triage's mapping everywhere (recommended), or per screen. This overrides ADR-0018's Senders behavior.
5. **Targets:** a first-30-days activation goal and a monthly budget, so the campaign section can use numbers.
