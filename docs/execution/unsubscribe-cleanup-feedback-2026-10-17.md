# Combined unsubscribe cleanup feedback

Owner and integration owner: this chat, `codex/tighten-unsubscribe-feedback`, isolated cad1 worktree. No dependencies. Shared ownership: action grouping/read contracts, global tray and label-batch readers, sender feedback, focused regression tests. Excludes onboarding, billing, provider behavior, permanent deletion, and further production mutations.

## Contract and observed baseline

The personal Gmail account was visibly verified before the explicitly requested one-sender cleanup. Preview showed 56 matching messages: 2 Inbox and 54 archived. The selected operation was Unsubscribe + Delete, Inbox + archived, all mail. The action was left in place as requested; it was not undone or repeated.

Observed sequence: confirmation said “Unsubscribing…”; row showed “Deleting…” plus “Requesting…”; tray showed “Deleting… · 1 of 2”; a separate unsubscribe-unconfirmed warning appeared; final tray said “Deleted 56 emails” with Undo. Activity persisted the delete and the separate unconfirmed result. This verifies the application-reported outcome, not independent Gmail-provider readback or stopped future mail. Production screenshots and mailbox identifiers are not committed.

One confirmation must produce one persistent running/result surface, honest separate move and request outcomes, real email counts, and Undo for the move. Acceptance means endpoint acceptance, never proof future mail stops. Unsubscribe-only, manual instructions, and submission failures retain their existing feedback.

| State / transition                                | UI and cache behavior                                                                                               | Verification                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Confirm accepted / both jobs running              | One “Working…” tray; no internal fraction for one sender, no premature Undo; redundant pending row label suppressed | component and browser                   |
| Move finishes before request                      | Running group stays visible; real execution keeps group running                                                     | real service, component                 |
| Request accepted                                  | Actual move count plus accepted-request note and Undo                                                               | real service, component, browser        |
| Request unconfirmed / failed / manual fallback    | Separate request outcome retained beside successful move; warning stays expanded                                    | real service, component, browser        |
| Delete fails while request succeeds               | Delete failure remains explicit; sender count never becomes an email count                                          | contract tests                          |
| Move-only group finishes before execution linkage | Reobserving running work reopens terminal reporting                                                                 | component regression                    |
| Partial bulk / overdue                            | Label readers use move-only totals and failures; global tray tracks whole decision                                  | helper and existing surface regressions |
| Status read fails                                 | Unknown/error remains distinct from success                                                                         | existing regression and browser         |
| Undo / late warning / switch                      | No resurrected warning after Undo; late attention expands; mailbox state remains scoped                             | component and browser                   |
| Older API or older same-key execution             | Existing separate feedback remains; no intent row interpreted as acceptance                                         | API replay and web contract tests       |

## Repairs

The intent reservation was linked to the move while the real delivery job was separate. New one-click execution jobs share the cleanup group. Progress and batch reads exclude intent bookkeeping, retaining those rows for quota/idempotency/Activity. Versioned opt-in is emitted only after actual execution linkage is verified. Web deployment before API deployment therefore keeps the independently watched outcome.

The global tray joins terminal unsubscribe detail onto the corresponding Undo result. Move-only consumers normalize combined counts: an accepted request contributes one sender, not one email. Running/unknown/partial/error, protected skips, recovery, and existing Undo boundaries remain distinct.

Independent review found and prompted fixes for the real intent/execution mismatch, late warning compaction, post-Undo residue, bulk label counts, and fast-linkage reporting. Gate review covers design, architecture, and flow completeness. No provider permissions, schema/migration, payment, or retention policy changes.

## Verification and limits

New regressions failed against the original counter/outcome logic. Real-service regressions also failed against the original grouping, including falsely accepted manual intents. The isolated browser harness bundles the changed production React components and global tray adapter against a loopback synthetic API. Desktop and 320px checks cover running, unconfirmed, acceptance, Undo and account isolation. No real session or provider credentials are used by that harness. This is separate from the required Next production build and budgets and from deployed production verification.

Priorities beyond this repair: Activity still exposes intent/move history and terminal execution as separate historical rows; a future combined history design should preserve both facts. Broader bulk/manual submission-copy tightening remains a separate scope. Neither requires new mailbox content collection.

Final focused suites: 479 web tests, 281 API tests, and all 920 shared tests passed. Two existing opt-in Activity performance benchmarks were skipped. Repository lint passes with six pre-existing unused-disable warnings. Independent design/architecture/flow review has no remaining actionable findings. Next production build, 51-route bundle budgets, 32-route prerender check, and sequential repository typecheck passed. A subsequent CI glossary failure on the initial running label was repaired by using “Working…”; the complete shared suite passes. Production provider changes were not repeated.
