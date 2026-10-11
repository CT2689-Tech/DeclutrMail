# Inbox Report mocks (Oct 10)

These are read-only design mocks for the Inbox Report reveal on Senders. Every PNG carries the "Mockup · sample data" badge, and every number is sample data. No repo changes, PRs or messages were made.

**Copy:** Content's v2 files, word for word.
- `/workspace/content/inbox-report-copy-oct10.md`, where §P wins.
- `/workspace/content/screen-copy-oct10.md` for the chrome, the Senders subtitle and the Plus pill label. Its §P wins, and it includes A1–A5.
- The rendered HTML passes the §P.5 banned-words check. See `../screen-mocks/README.md` → Verification.

**Regenerate:** `cd src && python3 gen.py && node render.cjs`.
- Uses playwright-core from `/workspace/tools/pw` with `/usr/bin/google-chrome`.
- Desktop renders at 1280x800 (DSF 1). Mobile renders at 390x844 (DSF 2).
- The page chrome comes from `../../screen-mocks/src/screens.css` (Bundle H), so in a repo the two folders must stay side by side (`docs/design/inbox-report` and `docs/design/screens`).

## Files
| File | What it shows |
|---|---|
| desktop-/mobile-senders-report.png | The report panel on Senders: the 91% headline, the support line, the envelope row (9 plum + 1 faded, "about 9 in 10 emails"), the facts "85,207 emails, going back to 2012" and "About 1.5 GB of your email is in 118 messages over 5 MB.", the footnote, the fix row ("122 of these senders include an unsubscribe link.", **Unsubscribe + archive 122 senders**, Review them first, Not now) and the trust line |
| desktop-/mobile-report-celebration.png | "Archived 2,708 emails from 122 senders.", the unsubscribe status, the Free chip "640 of 1,000 free emails left · resets Nov 1", the v2 storage note, Undo, Make a share card and the Undo note |
| desktop-/mobile-report-calm-fallback.png | "Your inbox is in good shape." and "845 emails, and 12 senders that might be worth a look.", with the ghost CTA **Show those 12 senders** |
| desktop-/mobile-senders-report-dismissed.png | The collapsed strip "Your Inbox Report · Reopen" |
| share-1200x630-{light,dark}.png, share-1080x1350-{light,dark}.png | The first-person share card (§6): "My Gmail, by the numbers", ~85,000 emails, 91%, ≈ 7.7 GB, ~2,700, and "Made with DeclutrMail · declutrmail.com" |
| motion-spec.md | Timing, easing and reduced-motion rules for the reveal, the count-up and the celebration |
| src/ | `gen.py` (HTML generator), `report.css` (tokens and report styles), `render.cjs` (renderer and layout checks), and the generated `*.html` |

## Chrome
- **Desktop:** a 72px rail and the top-bar kicker "Cleanup".
- **Mobile:** a header with the drawer button, plus the tab bar Home · Cleanup · Auto · Catch up · Activity.
- **Sub-nav:** Senders · Triage · Screener, with a "Plus" pill. The pill's spoken name is "Screener, Plus feature", built from visually hidden text (A4).
- **Page title:** "Senders" (Fraunces 32/400) with the v2 subtitle "Unsubscribe, archive or delete email by sender. You see what will change before anything moves."

## v2 copy changes in this batch
- **Trust line:** "This report uses only the sender, date, size, labels and read/unread status of your email, plus who you’ve emailed. We never fetch or store full email contents." followed by the link "What we store and share →".
- **"About" for sizes:** sentences and fact tiles now say "About 1.5 GB". "≈" appears only on the share cards.
- **Free chip:** "{remaining} of {allowance} free emails left · resets {resetDate}". On mobile it renders at 12px so it stays on one line.
- **Celebration storage note:** "Archived email stays in Gmail, so your storage doesn’t change. To free space, delete instead." It shows because this report showed insight #3.
- **Senders subtitle:** replaced (A3).
- **Reflow, desktop:** the report grid changed from 320/1.2fr/1fr to 320/1.1fr/1.1fr so "About 1.5 GB" fits on one line. Fact numbers no longer wrap.

## Mobile fold (tab bar top = 780px)
| Mock | Primary action y (px) |
|---|---|
| mobile-senders-report | 579–623 |
| mobile-report-calm-fallback | 397–441 |
| mobile-report-celebration | 446–490 (Undo / Make a share card) |
| mobile-senders-report-dismissed | no primary action |

## Open items
- **"Not now" in the fix row** is kept because report copy §6.1 says "keep both". A2's ban on "Not now" applies only to Coming with Pro.
- **"labels" first-use explainer:** in these screens, the first "labels" is inside the trust line, which Content wrote without "(Gmail’s version of folders)". I left the trust line as written. Content needs to confirm.
- **Not mocked:** the upgrade line (§7), the share sheet and share CTA line, the sweeper line, the Delete and Archive explainers, and the Free-cost line.
