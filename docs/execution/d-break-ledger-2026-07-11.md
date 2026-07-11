# D-break ledger — 2026-07-11 public-pages + UX buildout

> One row per PR in the wave. Every PR body carries its own `## D-ledger`
> section; this file is the aggregate index. Reverting any single PR:
>
> ```bash
> ./scripts/revert-pr.sh <PR_NUMBER> --push
> ```
>
> Each revert is a single squash-commit revert — no partial state.

## Legend

- **Implements** — the PR ships a D as specced (no break).
- **Amends** — deviates from the D's letter, spirit intact. Founder can
  ratify (update plan) or revert.
- **Breaks** — contradicts a locked D. Requires founder ratification or
  revert. **None of the hard guardrails (CLAUDE.md §2) are broken by any
  PR in this wave.**
- **D-candidate** — new decision not covered by any D; flagged for the
  founder to number and ratify.

## Wave status

PR numbers fill in as PRs open. Rows marked _(planned)_ until then.

| PR          | Branch                                    | D refs               | Type                                    | What deviates                                                                                                                                                                                                                              | Revert                                                        |
| ----------- | ----------------------------------------- | -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| _(planned)_ | `feat/d131-marketing-chrome`              | D131                 | Implements + amends                     | Footer expanded beyond spec (columns incl. /vs links); /beta de-orphaned                                                                                                                                                                   | `revert-pr.sh <N>`                                            |
| _(planned)_ | landing upgrade                           | D134, D135, D228     | Implements + amends                     | D134 §2 trust-strip copy uses D228 patched wording (never "Bodies read: 0 forever"); trust strip gains CASA badge + outcome counters beyond D138 list; D135 hero implemented as CSS keyframes instead of Framer Motion (same 5-frame spec) | `revert-pr.sh <N>`                                            |
| _(planned)_ | `/how-it-works` + `/methodology` + `/faq` | D132, D139, D140     | Implements                              | —                                                                                                                                                                                                                                          | `revert-pr.sh <N>`                                            |
| _(planned)_ | compare program `/compare` + `/vs/*`      | D132, D142–D145      | Implements + **amends D132**            | Adds 6th slug `/vs/unroll-me` beyond D132's locked five (search-demand justified)                                                                                                                                                          | `revert-pr.sh <N>` (or delete the one route to keep the rest) |
| _(planned)_ | `/inbox-simulator`                        | D133                 | Implements                              | —                                                                                                                                                                                                                                          | `revert-pr.sh <N>`                                            |
| _(planned)_ | pricing + security upgrade                | D17, D19, D121, D141 | Implements + amends                     | Free-tier copy reframed ("taste the ritual…") — quota number (5 lifetime) unchanged, D19 intact                                                                                                                                            | `revert-pr.sh <N>`                                            |
| _(planned)_ | `/blog` + `/changelog`                    | D132, D218           | Implements + **amends D132 sequencing** | Tier 5 shells were "populate organically post-launch"; launch posts ship now                                                                                                                                                               | `revert-pr.sh <N>`                                            |
| _(planned)_ | `/how-to/*` + `/answers/*`                | D132                 | **Amends D132 sequencing**              | Tier 3/4 were "waves over first 8 weeks post-launch"; all 10 ship now (content-only)                                                                                                                                                       | `revert-pr.sh <N>`                                            |
| _(planned)_ | `/help` expansion                         | D137                 | Implements                              | —                                                                                                                                                                                                                                          | `revert-pr.sh <N>`                                            |
| _(planned)_ | `fix/d029-gmail-roundtrip-trust`          | D29, D34             | Implements + safety alignment           | archiveHistoric skip-sheet default aligned to sheet default (safer)                                                                                                                                                                        | `revert-pr.sh <N>`                                            |
| _(planned)_ | `fix/d207-ux-consistency-sweep`           | D207, D211           | Implements + D-candidate                | Label-mode Settings toggle added (default unchanged — 'power'); flip-default decision left to founder                                                                                                                                      | `revert-pr.sh <N>`                                            |
| _(planned)_ | `feat/d224-sync-error-banner`             | D224                 | Implements                              | Closes migration-0027 FE gap                                                                                                                                                                                                               | `revert-pr.sh <N>`                                            |
| _(planned)_ | `feat/d227-gmail-muscle-memory`           | D227-adjacent        | **D-candidates**                        | `e`-archives alias (handler-level, registry untouched); j/ArrowDown row nav; first-swipe coach mark (mapping NOT flipped); first-Keep receipt                                                                                              | `revert-pr.sh <N>`                                            |

## Open D-candidates for founder ratification

1. **`/vs/unroll-me` as 6th comparison slug** — amend D132 or revert route.
2. **Label-mode default** — 'plain' vs 'power' for new users; toggle ships
   either way (this wave ships toggle only, default untouched).
3. **`e` archive alias + j-navigation** — amend D227 registry notes or
   revert handlers.
4. **Swipe direction** — right=Keep (current) is inverse of Gmail's
   right=archive muscle memory; coach mark ships now, flip is founder call.
5. **Bulk one-click unsubscribe** — NOT built this wave (already logged as
   D-candidate in FOUNDER-FOLLOWUPS via PR #323); respects D230
   mailto-manual rule when built.

## Explicit non-builds (respecting locked Ds)

- **No `/features` page, no 'Features' nav item** — D131 locks the 6-item
  nav; D132's 28-page IA has no features page. Feature preview lives on
  the landing (D134 §6).
- **No standalone `/about`** — founder bio ships inside `/methodology` §8
  per D136/D139.
- **No testimonials** — D136 bans them until ~2026-08-10; landing reserves
  the slot, ships non-testimonial proof (counters, CASA, guarantees).
