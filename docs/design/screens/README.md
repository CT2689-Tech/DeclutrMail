# Bundle H screen mocks (Oct 10, updated Oct 11)

## Changelog
- **drop2-r3 (Oct 11):** applied launch copy deck `/workspace/content/launch-copy-deck/json/` (README says drop2-r3; the JSON `_meta.revision` reads **drop2-r4**, errata adding `ws5.f2.homeTile.*` and confirming the trust line keeps "labels" unexplained; strings snapshotted from that JSON into `../inbox-report-mocks/src/deck_strings.py`). Removed "(Gmail’s version of folders)" everywhere (WS5 bans "folders"); Home storage fact is now the tile "≈ 7.7 GB" / "of email in your Gmail"; the vendor, 5 MB and years facts render as the deck's sentences (with "about"); glyph caption "about 9 in 10"; report close aria "Close Inbox Report"; Brief disclosure → `ws2.pro.brief.disclosure`; footnote → `ws5.report.basis` + `sizesNote`; new AI consent (`ws2.aiConsent.*`) and Settings → AI mocks (8 PNGs).
- **v2 (Oct 10):** Content v2 copy, A1–A5, commit-ready bundle.

Read-only design mocks for Product's Bundle H. I made no repo changes, opened no PRs and sent no messages. Every PNG carries the "Mockup · sample data" badge. All numbers are sample data. Copy comes from Content's **v2** files (Oct 10, late plain-language pass): `/workspace/content/screen-copy-oct10.md` (RECOMMENDED column; §P wins over older rows; Additions A1–A5) and `inbox-report-copy-oct10.md` (§P wins). Every mock was re-rendered against v2 on Oct 10; see "Copy status" below.

Regenerate: `cd src && python3 gen.py [name.html ...] && node render.cjs [name.html ...]`. With no args, every file is regenerated.
Rendering uses playwright-core (/workspace/tools/pw) with /usr/bin/google-chrome. Desktop renders at 1440x900 (DSF 1); mobile at 390x844 (DSF 2).

## Files

### Home v1 (16)
Each file is named `home-{state}-{desktop|mobile}-{light|dark}.png`.

- **home-full-\***:
  - header: H1 "Home", the allowance chip tagged "EXAMPLE", and "Free plan · Compare plans"
  - the report card, kicker "Your Inbox Report · Updated 6:10 AM". Facts (deck drop2-r3/r4): the tile "≈ 7.7 GB" / "of email in your Gmail" (`ws5.f2.homeTile.*`) and the sentence "47,764 emails (about 4.4 GB) are filed under Unroll.me labels in your Gmail." (`ws5.report.thirdParty`, no folders explainer). On desktop the two facts stack in one column
  - mobile: the `unsub_archive` card title carries the A5 info button (icon only, 44px target, aria "What “mostly leave unread” means") instead of a body line
  - **Suggested next steps**: the `unsub_archive` card as primary, with `largest` and `later_due` as secondary cards (Content §7.2)
  - "Progress since you joined · Aug 11" with "See your activity"
- **home-calm-\***: "Your inbox is in good shape", "Nothing stands out right now. New senders and changes show up here after each scan." and "See your senders" (§7.3), plus the progress line.
- **home-empty-\***: the first scan is still running (`home.syncing`): "Your first scan is running", a progress bar, "Found 31,214 emails" and "See your senders".
- **home-scan-failed-\***: kicker "Gmail account needs attention" with the sync-gate `unknown` state: "The scan stopped", "52,180 of 85,207 emails", **Try again** and Get help, right on Home. Calm, neutral plum, no red.

Desktop uses the 72px repo nav rail, and Home has no kicker (Content §1.5). Mobile has the header, the drawer button and the bottom tab bar: Home · Cleanup · Auto · Catch up · Activity.

### AI consent and Settings → AI (8, new Oct 11, deck `ws2.aiConsent.*`)
- **pattern-ai-consent-home-{desktop,mobile}-{light,dark}.png**: the consent card on Home, variant `.all` (suggestion explanations only, the launch case since Pro is waitlist-only). Title, intro, "Suggestion explanations" + `explain.sends`, the four guarantee lines (`never`, `noFetch`, `who`, `training`), `decline.all`, **Allow** (primary) / Not now, and "You can change this any time in Settings → AI." + "How we use AI".
  - Desktop: an inline two-column card above the report on Home (what is sent on the right).
  - 390 mobile: a bottom sheet over Home (`role="dialog"`, `aria-modal`). The body scrolls under a fade; Allow / Not now are pinned at the bottom in the thumb zone. Allow sits at 734–778, above y=780 even though the sheet covers the tab bar.
- **pattern-ai-consent-home-withbrief-{desktop,mobile}-light.png**: variant `.withBrief` (Pro): title/intro/decline `.withBrief` plus the "Daily Brief" section with `brief.sends`. On mobile the decline and change lines sit under the fade (reachable by scrolling).
- **pattern-ai-settings-{desktop,mobile}-light.png**: Settings with the AI row: `settings.label.all`, `settings.help.all`, "How we use AI", and a switch (`role="switch"`, labelled and described by the row) showing `settings.state.on` "On". The section heading "AI" is not a deck key (from "Settings → AI" in `aiConsent.change`).

### Patterns (18)
- **pattern-pro-locked-desktop-light.png, pattern-pro-locked-mobile-light.png**: the "Coming with Pro" screen on /brief (Content §4.1).
  - Header: the "Coming with Pro" pill above the H1 "Daily Brief", with the pitch "A daily summary of yesterday’s email in DeclutrMail, ready at an hour you choose."
  - Card: "Pro isn’t available yet.", primary **Join the Pro waitlist** and secondary link **Go to Later** (Content A2 RECOMMENDED; replaces "Not now"; plain link to /later, records nothing).
  - The Brief disclosure (`ws2.pro.brief.disclosure`, deck drop2-r3; replaces `BRIEF_PROCESSING_NOTE`) appears verbatim, next to a faded, static skeleton preview.
  - **No /billing link, no price, no checkout** (plan §2.3). The button posts to the waitlist endpoint (`data-action="waitlist:pro"` in the HTML).
- **pattern-pro-nav-badge-desktop-light.png**: the expanded 220px sidebar.
  - Groups: Home / Cleanup / Automations / Catch up / Activity.
  - An 11px "Pro" pill on Daily Brief and Follow-ups. Spoken name "Daily Brief, coming with Pro" (A4 / §4.4).
  - "Plus" on Screener, Autopilot and Quiet hours. Spoken name "Screener, Plus feature" (A4).
  - Per A4's accessibility note, the spoken suffix is a visually hidden span inside the row (`.sr-only`), and the visible pill is `aria-hidden`. No `aria-label` on a bare span. The same pattern is used for the sub-nav Plus/Pro pills on every screen.
- **pattern-pro-nav-badge-mobile-light.png**: the same badges in the mobile drawer (300px wide, 44px rows), shown over Home with a scrim.
- **pattern-caught-up-{desktop,mobile}-{light,dark}.png**: one reusable empty state with a title, one line and one action (Content §6).
  - Desktop, Triage: "Nothing needs a decision right now", "New suggestions appear as senders email you again." and "Browse senders"; the subtitle is "Today’s senders · one choice each" (§P.4).
  - Mobile, Screener: "No new senders waiting", "New senders show up here for review. Their email keeps arriving in Gmail until you decide." and "See all senders".
- **pattern-caught-up-later-{desktop,mobile}-{light,dark}.png** (new, A1): "Nothing in Later", "Move a sender to Later from Senders or Triage. Their email waits under the DeclutrMail/Later label in Gmail, then returns to your inbox at the time you pick." and **See your senders**. Free workspace, so Daily Brief and Follow-ups carry Pro pills in the sub-nav.
- **pattern-caught-up-followups-{desktop,mobile}-{light,dark}.png** (new, A1): "No follow-ups right now" and "None of your sent email looks like it’s waiting on a reply." **No CTA** (A1: nothing to act on). Shown in a **Pro** workspace (no Pro pills), because only Pro can ever see this state; everyone else gets Coming with Pro.
- **pattern-unread-info-mobile-{light,dark}.png** (new, A5): the bottom sheet the info button opens, over Home full: "Less than 10% of their email was marked read in Gmail in the last 90 days. Gmail only tells us whether email is marked read. It can’t tell whether you looked at it." and **Close**.

### report/ (8)
These are copies of the Inbox Report mocks from `../inbox-report-mocks/`, where the originals were overwritten. The share cards were not touched.

They now use the Bundle H page chrome:
- the 72px rail (desktop) or the header, drawer button and bottom tab bar (mobile): Home · Cleanup · Auto · Catch up · Activity
- a sub-nav of Senders · Triage · Screener (with a Plus pill), and the top-bar kicker "Cleanup" (Content §1.5)
- the unified page title "Senders" (Fraunces 32/400) with the v2 subtitle "Unsubscribe, archive or delete email by sender. You see what will change before anything moves." (§P.3 / A3 RECOMMENDED, static); the rust "Make room." accent and the eyebrow above the title are removed
- the unified sans kicker "Your Inbox Report" instead of the mono plum kicker with a dot
- "A closer look." as a sans 17/600 card title

Report strings follow the deck (drop2-r3/r4): trust line, facts as sentences `ws5.report.yearsDeep` ("Your email goes back to 2012. 64% of it is more than 3 years old.") and `largeMail` ("About 1.5 GB of your email is in 118 messages over 5 MB."), footnote `basis` · `sizesNote`, close aria "Close Inbox Report"; and report copy v2 for the rest ( Free chip "640 of 1,000 free emails left · resets Nov 1", celebration storage note). Desktop stays at 1280x800, the original report-mock size; Home is 1440x900.

The report generator links `../../screen-mocks/src/screens.css` directly, so both sets of mocks share one source for the chrome.

- desktop-senders-report.png / mobile-senders-report.png
- desktop-report-celebration.png / mobile-report-celebration.png
- desktop-report-calm-fallback.png / mobile-report-calm-fallback.png
- desktop-senders-report-dismissed.png / mobile-senders-report-dismissed.png

### src/
- **gen.py**: the HTML generator. It imports `../../inbox-report-mocks/src/gen.py` for icons and glyphs.
- **screens.css**: shells, navigation, cards and states.
- **base.css**: tokens and base styles, copied from the report mocks.
- **render.cjs**: the Playwright renderer. It reports fonts, the primary element's y position against the tab bar, and any overflow.
- **\*.html**: the generated pages.

## Tokens used
- **Light:**
  - `--bg #f6f2eb`, `--card #fffcf8`, `--fg #2d2630`, plus fg-muted and fg-subtle
  - `--primary #59415f` (plum)
  - `--nav-bg #2b2230`
  - `--marker #d8a975`, used only for the active nav indicator
- **Dark:** `--bg #1e1a21`, `--card #302a32`, `--primary #d1b8d6`. Borders and fills follow the dark tokens.
- **Type scale:** 11 / 12 / 13 / 14 / 15 / 17 / 20 / 24 / 32 / 44, plus the proposed `display-xl` (64px Fraunces 300, tabular figures, report headline only).
- **Unified styles:**
  - One kicker style: 11px/600, uppercase, .08em tracking, fg-muted.
  - One page title style: Fraunces 32/400 at every width.
  - Card titles: sans 17/600. State titles: sans 20/600.
- **Radii:** 8 / 10 / 14 / 20 / 28 / pill. Cards use 20; inner cards and the active tab-bar pill use 14.
- **Spacing:** 4–64 scale.
- **Envelope row (caption "about 9 in 10", `ws5.report.glyph`):** 9 solid envelopes in `--dm-primary` (plum #59415f light, #d1b8d6 dark) stand for the share from senders you mostly leave unread, the emphasized part. 1 faded outline (32% opacity) stands for the rest. It is used on Home full, the report panels and the share cards.
- **Fonts:** Geist, Fraunces and Geist Mono. Mono is used only for the mockup badge. The rust accent is not used anywhere in these mocks, including report/ (the share cards are separate).

## Verification
I viewed every PNG. All fonts loaded in every render, and nothing clipped or overflowed.

On mobile, every primary action sits above the bottom tab bar (tab bar top = 780px) on the first screen:

| Mock | Primary action y (px) | Change vs. last batch |
|---|---|---|
| home-full | 610–654 ("Unsubscribe + archive 158 senders") | Oct 11: was 628–672; the storage tile is shorter. 126px clear of the tab bar |
| home-calm | 340–384 ("See your senders") | was 306–350; v2 trust line is one line longer |
| home-empty | 383–427 ("See your senders") | was 349–393; same reason |
| home-scan-failed | 384–428 ("Try again") | was 350–394; same reason |
| caught-up (Screener) | 335–379 ("See all senders") | unchanged |
| caught-up Later (new) | 377–421 ("See your senders") | new |
| caught-up Follow-ups (new) | no CTA (by design, A1) | new |
| pro-locked | 293–337 ("Join the Pro waitlist") | unchanged |
| unread-info sheet | sheet covers the tab bar; Close at the bottom of the sheet | unchanged |
| AI consent sheet, all + withBrief (new Oct 11) | 734–778 ("Allow", pinned sheet footer; sheet covers the tab bar) | new |
| Settings → AI (new Oct 11) | no primary action (a switch) | new |
| report mobile-senders-report | 620–664 ("Unsubscribe + archive 122 senders") | Oct 11: was 579–623; the deck's two fact sentences + basis footnote are longer |
| report mobile-report-calm-fallback | 397–441 ("Show those 12 senders") | was 376–420; subtitle |
| report mobile-report-celebration | 446–490 ("Undo" / "Make a share card") | unchanged (no subtitle on this one, as before) |

Desktop (no tab bar): home-full CTA 557–601 of 900; AI consent Allow 304–348 (withBrief 372–416) of 900; report desktop CTA 456–500 of 800.

The nav-badge drawer and the dismissed strip have no primary action.

**Banned-words check (Oct 11, drop2-r3).** Same script, now over 54 HTML files, plus raw greps for "folders", "Gmail’s version", "briefConsent" and unfilled `{TOKEN}`s, and visible-text checks for "hidden", "allowance", "free up", "time saved", "never/rarely/barely open". Result: **0 hits** for all of them. The only matches are the two expected ones below (and "Not now" now also inside the deck's `aiConsent.decline` and `aiConsent.notNow`). "≈" appears only on tiles/chips: the Home tile "≈ 7.7 GB" (13 files) and the 4 share cards; "about" appears only in sentences.

**Banned-words check (Oct 10, v2).** A script ran every pattern in screen-copy §P.5 (the YAML `banned` list) over the visible text, `aria-label`, `title` and `alt` of all 46 rendered HTML files (screen-mocks/src and inbox-report-mocks/src, share cards included), plus a raw-HTML grep for "[CONTENT]", "Clean up", "Next best", "See Pro", "billing?plan", "never open", "rarely", "barely" and "declutrmail.ai". Result: **0 hits** for all of those. Two expected matches remain:
- "Today’s senders · one choice each" (Triage subtitle) matches the `Today` nav-name pattern. It's Content's exact §P.4 string, and the rule's context is nav/screen names, so it stays.
- "Not now" in the report fix row. Report copy §6.1 says keep it there; A2's "don't use Not now" applies to the Coming with Pro screen, which now says "Go to Later".
"≈" appears only on the 4 share cards ("≈ 7.7 GB"), which both files allow.

## Deviations from the wireframe or plan, and why
1. **Pro CTA is "Join the Pro waitlist"** (Product decision, plan §2.3, Content §4.1). There is no /billing link, no price and no checkout. The secondary is now Content's "Go to Later" (A2).
2. **"Try again", not "Retry"**: it is the existing product verb, and the copy is Content §2.2 state 7 (`unknown`). The `needsReconnect` variant ("Reconnect Gmail", states 1–3) and the auto-retry "Your scan will resume" overlay are not mocked. Today SYNC_FAILED_ACTION is "Open Settings"; this mock moves the retry onto Home.
3. **Home v1 = P0 scope only**: report, suggested next steps, progress line and chip. Since-last-visit, unsubscribe outcomes, storage and the weekly chart are left out as P1/H8.
4. **"Empty" state** shows `home.syncing` (first scan running). Content's pre-report `home.empty` variant is not mocked (see "Copy status").
5. **Mobile full Home**: the trust line moved below the suggested-steps card so the fix CTA stays above the tab bar. Per A5 (RECOMMENDED, option b) the mobile card shows the info button after "mostly leave unread" instead of the body line, so the definition is always reachable; desktop shows the body line. The ALTERNATE (`Under 10% marked read in 90 days.` visible) would cost about 18px; there is room (CTA bottom 672 vs. tab bar 780).
6. **Drawer and bottom tab bar both kept** on mobile (Product decision; the drawer keeps the full route list). Picking one is post-launch (audit #35).
7. **Desktop Home uses the 72px rail.** The badge pattern uses the expanded 220px sidebar so the labels are visible.
8. **Pro/Plus badges are always visible.** The repo currently hides lock chips until hover. The badge is 11px and 18px high, as briefed. The Pill component is 12px and 22px, so either add an `sm` size to Pill or accept the difference.
9. **The allowance chip appears only in the Home header**, not repeated in the app chrome.
10. **"Auto"** is the mobile short label for Automations, per the plan. It is also applied to the report mocks.
11. **Nav group label "Cleanup"** (Content RECOMMENDED, a noun, passes D209; pending Chintan) replaces "Clean up" in the rail, the tab bar, the sub-nav kicker and the drawer. ALTERNATE "Clean up" is a one-word flip in both gen.py files.
12. **The caught-up pattern** is shown on Triage (desktop) and Screener (mobile) in the base files, and on Later and Follow-ups in the new A1 variants.
13. **The report mocks use the Bundle H chrome** (see report/ above). The page eyebrow "Your inbox, by sender" and the rust "/ Make room." tagline were dropped; Content §1.5 replaces that eyebrow with the group kicker "Cleanup", shown in the top bar. The report panel's calm fallback uses the report-copy strings ("Your inbox is in good shape." / "Show those 12 senders"); Home calm uses screen-copy §7.3. That is intentional, since they are two different files.
14. **"Unroll.me" is named in-app** (wireframe figure). Naming the vendor is Chintan's call.
15. **"labels" first-use explainer: RESOLVED Oct 11.** Deck drop2-r3/r4 keeps the trust line word for word with no explainer and WS5 bans "folders", so "(Gmail’s version of folders)" is gone everywhere. (Old note: report v2 §P added "(Gmail’s version of folders)" the first time "label" appears in the report. On Home full that is the vendor fact, so it's appended there. On screens without the vendor fact (Home calm/empty/scan-failed, all report/ screens) the first "labels" is inside the §3 trust line, which Content wrote without the parenthetical; I left the trust line word for word. Superseded.)
16. **Home fact label: RESOLVED Oct 11.** Now the deck tile `ws5.f2.homeTile.*`: "≈ 7.7 GB" / "of email in your Gmail". (Old note: The old "total email, all time" came from the IA wireframe, not Content. It's now the share-card line "of email" with "About 7.7 GB" (v2: "about" in sentences). Superseded.)
17. **Fact numbers no longer wrap** (`white-space:nowrap` on `.fact .n` and `.chip`). The report desktop grid moved from 320/1.2fr/1fr to 320/1.1fr/1.1fr so "About 1.5 GB" fits on one line, and the mobile celebration chip is 12px so the longer v2 chip stays on one line.

## Copy status (v2)
- **Placed (RECOMMENDED, word for word):**
  - §1.1 names: Home, Cleanup, Automations/Auto, Catch up, Activity, Plan & billing, Daily Brief; §1.5 kickers
  - §2.1 count formats; §2.2 state 7
  - §4.1 badge, title, pitch, `BRIEF_PROCESSING_NOTE`, status, CTA; §4.4 / A4 nav badge spoken names
  - A2 `pro.secondary` "Go to Later"
  - A3 / §P.3 `senders.subtitle` (static RECOMMENDED)
  - A4 `nav.item.plus` "Screener, Plus feature" (also Autopilot, Quiet hours) and `nav.item.pro` "Daily Brief, coming with Pro" / "Follow-ups, coming with Pro"
  - A5 `home.next.unsub.info.button` (mobile), `info.body`, `info.close`
  - A1 `later.empty.*` and `followups.empty.*` (no CTA)
  - §6 `triage.caughtUp`, `triage.subtitle` (v2 "Today’s senders · one choice each"), `screener.empty`, `home.syncing`
  - §7.1 h1, plan.free, report.label, report.updated, next.label, progress.*, link.activity; §7.2 `unsub_archive`, `largest` (v2 §P.3 wording), `later_due`; §7.3 calm
  - report v2: trust line, §1 headline/support, calm fallback + "Show those {k} senders", §2 vendor card with "about", §4 "About {size}" insight #3, footnote, storage note, §6 share card, §6.1/7.1 fix heading, buttons, celebration, unsubscribe status, Undo note, Free chip
- **Not placed (no matching screen or state in this batch):**
  - `home.empty` ("Nothing to show yet" …), `home.help.title` / `home.help.body`, `home.link.triage` ("Review one sender at a time")
  - the §7.2 `screener` card (P1)
  - `pro.cta.busy`, `pro.joined`, `pro.joined.sub`, `pro.error`, `nav.item.pro.joined`, `nav.hint.*` (collapsed-rail tooltips)
  - §4.2 Follow-ups gate pitch (only the Brief gate is mocked)
  - `triage.done`, `triage.subtitle.day1`, `senders.caughtUp(.plus)`, `senders.none`, `followups.emptyExcluded.*`
  - the §5 Plus pitches, `page.badge.plus`
  - sync-gate states 1–6, overlays, `syncGate.*` progress/ready strings, `explain.inboxReport`
  - §P.2 explainers for Screener, Triage, Autopilot, Quiet hours, Later, Activity, Protected (no intro panels mocked)
  - report v2: upgrade line (§7), share sheet strings and share CTA line, sweeper line, Delete/Archive explainers, Free-cost line
- **Deck drop2-r3/r4 placed:** `ws2.aiConsent.*` title/intro/decline (`.all`, `.withBrief`), explain.*, brief.*, never, noFetch, who, training, change, link, allow, notNow, settings.label.all, settings.help.all, settings.state.on; `ws2.pro.brief.disclosure`; `ws5.f2.homeTile.*`; `ws5.report.thirdParty`, `largeMail`, `yearsDeep`, `basis`, `sizesNote`, `glyph`, `close.aria`, `trust`, `trust.link`; `ws1.meter.chip` + `.aria`.
- **Deck drop2-r3/r4 not placed (no matching state mocked):** `ws2.aiConsent` toasts, `existingUsers.*`, `upgrade.*`, `reask`, `killSwitch`, `error`, `settings.label/help.withBrief`, `settings.state.off/paused/review`; `ws2.aiPrompt.*`; `ws5.report.thirdParty.detail` (expanded vendor detail not mocked), `largeMail.top10`, `recent`, `people`, `trash`, `upgrade.*`, `fix.cost`; share sheet/intent strings.
- **Not in the deck JSON:** several on-screen strings come from Content's v2 screen/report files (e.g. "Updated 6:10 AM", "Today’s senders · one choice each", the A1 caught-up strings, the A5 info sheet, the Home suggested-step bodies). They were left as v2 wrote them.
- **Missing from Content:** the section heading "AI" on Settings (I used the word from "Settings → AI").
- **Illustrative numbers:** quota, progress totals, scan counts and update time.

## Deferred to after launch
- Unsubscribe result labels/rows for sender detail and Activity (Content §9.1 has the copy ready).
- Picking either the mobile drawer or the bottom tab bar.
