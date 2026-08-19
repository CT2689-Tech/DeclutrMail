# Engagement-signal repair — build brief

**Status:** four decisions RATIFIED by the founder 2026-08-19. Nothing built.
**Prerequisite:** PR #566 (merged / auto-merging) shipped the honesty fixes this
brief builds on — read-rate windows named, `readRate90d` nullable end to end,
"marked read" never "opened", timeseries counters derived.

Evidence and full reasoning: `FINDINGS.md` → **F010**, **F011**, **F012**.
Do not re-derive the analysis. It is measured, on the founder's real mailbox,
and the numbers below are the baseline to verify against after each change.

---

## The one idea underneath all four

Gmail exposes exactly one engagement bit — the absence of `UNREAD`. There is no
open event and there never will be, because open tracking needs a pixel from
whoever _sent_ the mail. That single bit is writable by any tool with API
access, and on this mailbox Unroll.me has written it **20,812 times**.

So: **rank on signals a third party cannot manufacture.** A sweeper can mark
read. It cannot reply, star, or make someone open Gmail.

Everything below is that principle applied in four places.

---

## 1A — Re-arm the two dormancy presets on a real signal

The abstain shipped in #566: `newsletter_graveyard` and
`long_dormant_unsubscribe` now match nothing, because their `readRate90d < 0.05`
test could never fail (both require `lastSeenDaysAgo > 90`, which guarantees a
null 90-day rate). Founder ratified the abstain; this is the re-arm.

**Signal to use:** lifetime read rate, DECONTAMINATED (see 3A), over the
sender's own mail — not a rolling window that structurally excludes them.

**Measured impact on the founder's mailbox:**

|                                  | senders matched |
| -------------------------------- | --------------- |
| before (tautology)               | 6,615           |
| after abstain (shipped)          | 0               |
| re-armed, decontaminated         | **57**          |
| re-armed WITHOUT decontaminating | 23              |

The gap between 57 and 23 is the point: sweeper marks were disguising 34
genuinely-ignored senders as read. **1A is worth materially less if 3A has not
landed**, which is why the sequencing below matters.

Qualifier used for the 57: quiet > 90d, ≥5 received, unprotected, clean read
rate < 5%.

---

## 2A — Reply metric: strict rule + review screen

**The defect.** A "reply" is counted as _any_ outbound message in a thread the
sender appeared in — no predicate ties the outbound to the sender it credits.
It fails in BOTH directions:

- **Over-credits machines.** A bounce lands in a thread already full of
  outbound, so `mailer-daemon@googlemail.com` shows **14 replies**.
- **Under-credits people.** One contact: 529 messages actually sent to them,
  but only **80** sit in a thread that also contains their inbound, so the
  counter sees ~94 and misses 449.

**What to build**

1. **Display becomes "You wrote to them N×"** — outbound where their address is
   in To or Cc. True to its own name, verifiable by the user in Gmail
   (`to:their@address`), and unfakeable by a sweeper. Drop the word "replied";
   we cannot identify a causal reply, we can identify who was written to.
2. **Protection requires genuine two-way traffic** — ≥1 message FROM them AND
   ≥3 messages TO them. A bounce fails the first test; a CC'd thread fails the
   second.
3. **A protection review screen — this is the load-bearing part.** Never
   withdraw a shield silently. Senders that no longer qualify SURFACE for the
   user to keep or unprotect. Reuse the F005 onboarding protection-review
   pattern; it is the same screen.

**Measured impact:**

|                                                 | senders |
| ----------------------------------------------- | ------- |
| protected as `replied` today                    | 460     |
| survive the strict rule                         | 356     |
| surface for review                              | **104** |
| newly qualify (real contacts unprotected today) | **89**  |

Note 104, not the 57 quoted earlier in the session — 57 was the subset with
ZERO outbound addressed; the ≥3 threshold catches 47 more with one or two.

`recipient_emails` is `[...parseRecipients(to), ...parseRecipients(cc)]` and is
populated on 5,535 of 5,539 outbound rows, so the strict rule is measurable
today with no new Gmail data.

**Known false-negative risk, unmeasured:** a reply sent to a `Reply-To` address
or a mailing list credits neither the original sender nor anything else. This is
why the review screen exists rather than an auto-drop — measure this before
touching the DISPLAYED count.

---

## 3A — Decontaminate read rate

**Do not delete read rate.** It is contaminated, not fake, and deleting it
makes unsubscribe recommendations MORE aggressive for every sender — a sweeper
only ever marks READ, so it inflates the rate and currently SUPPRESSES cleanup.
Removing the brake is the wrong direction.

**What to build:** exclude sweeper-marked mail from the read-rate numerator.

We store `label_ids` but not label names, so `Label_117` is opaque. One
`labels.list` call per mailbox maps ids → names; flag messages carrying a known
sweeper label (`Unroll.me*`, Leave Me Alone, Cleanfox, Clean Email).

**This needs a D7 decision:** label NAMES are new metadata not in the Gmail data
inventory. Amend `packages/shared/src/contracts/gmail-data-inventory.ts` in the
same change, per CLAUDE.md §2.1.

**Measured impact:**

|                                            | senders |
| ------------------------------------------ | ------- |
| displayed 30-day % changes                 | 206     |
| lose a false "engaged reader" Keep         | 284     |
| gain the low-read nudge toward Unsubscribe | 286     |

**The one number that increases destructive-verb pressure in this whole brief
is that 286.** Every one of them must ride the normal preview-and-confirm path;
none may reach a bulk path without it.

Also worth doing here and cheap: SHOW the split
("324 of 350 marked by Unroll.me") so the product can explain an odd number
instead of silently compensating.

---

## 4A — Public marketing copy

Two live pages claim mail was "rarely opened", which Gmail cannot tell us:

- `apps/web/src/features/marketing/learn/blog-content.ts:87` — and the
  paragraph directly above it argues _"Sender volume and engagement are
  falsifiable facts"_. Worst possible place for an unfalsifiable claim.
- `apps/web/src/features/marketing/learn/how-to-content.ts:332`

Reword to "rarely marked read", matching the in-app vocabulary #566 shipped.
Zero data change. Founder-ratified, but it is their voice — keep the edit to the
verb.

---

## Build order — deliberate, not arbitrary

**2A → 3A → 1A.**

Protection improvements land BEFORE the recommendation loosening. 2A adds 89
shields; 3A then nudges 286 senders toward Unsubscribe. Doing 3A first means a
window where cleanup is more aggressive and the shields that should have caught
its mistakes are not in place yet.

1A last because its value depends on 3A (57 matches vs 23).

---

## Also open, unrelated to the four

- **F011 — search empty state.** Searching a dormant sender returns "No senders
  match" while the typeahead shows it. Not a filter bug; the copy blames the
  query and the two surfaces disagree. Agreed design: when a filtered search
  returns ZERO but matches exist outside the filter, auto-widen and show a
  reversible notice ("No active senders match X — showing all · [Keep active
  only]"), plus bucket labels in the typeahead. Founder did not need to decide
  this; it was left to the agent.
- **CI fragility.** `playwright install --with-deps` has no retry; an Ubuntu
  mirror stall burns 25 minutes and reds an unrelated PR — it did so four times
  in one session. Needs its own PR from the MAIN checkout, not a worktree
  branch (a `.github/workflows/` change makes a worktree-pushed branch
  unmergeable — the `gh` token lacks `workflow` scope).
- Demo fixtures in `apps/web/src/features/triage/data.ts` still say "You open
  0% of …". Fixtures only, not shipped copy.
- Decision-history dates render relative unconditionally; D46 requires absolute
  past 7 days.

---

## Traps this session paid for — do not relearn them

- **Verify derived-data fixes in a transaction and ROLL BACK before
  committing.** A dry run caught a fix that would have pushed 269 rows to
  `read_count > volume` — a read rate above 1, which cascade rule 5 reads as an
  ENGAGED READER. Assert the invariants (ratio ≤ 1, no negatives, no residual
  drift, orphans handled), not just the row you were chasing.
- **Month keys are UTC** (`startOfMonthISO` uses `getUTCMonth`). A bare
  `date_trunc('month', …)` uses the session zone and will silently mis-key
  boundary messages.
- **A gate agent's BLOCKING finding is a hypothesis.** One claimed 7,072 bad
  `rule_match_log` rows existed and would execute; one query showed both presets
  disabled with ZERO rows. Read the governing path before acting on a severity
  label — including one an agent assigned.
- **Assert the ABSENCE of banned wording, not just the presence of the right
  wording.** A positive-only test is what let "opened" survive a pass that was
  specifically about fixing "opened".
- **This repo is PUBLIC.** Do not put real subjects, addresses, or mailbox
  content into source comments or docs. Use shape descriptions.
- **The dev DB is the founder's real mailbox.** Force edge states reversibly
  and restore. The prod DB is readable read-only via
  `gcloud secrets versions access latest --secret=database-url-prod
--project=declutrmail-ai-prod`.
