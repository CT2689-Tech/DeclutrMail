# Home visual sharpening — 2026-10-25

The founder accepted the Action overview's data and requested sharper visual design. This chat owns Home presentation, its development preview/stories, and this evidence. Integration owner: this chat. No dependency PR or overlap with the open billing/mobile/operations PRs. Isolated branch: `codex/home-visual-sharpen-20261025`.

## Visual direction

Keep the mailbox-workspace character and existing app palette: lavender canvas `#f7f6f9`, white surface `#ffffff`, ink `#2b2730`, secondary ink `#6b6473`, purple `#6f568a`, and boundary `#d8d3de`. Implementation consumes the existing theme tokens, including their dark equivalents. Use the existing Geist/sans role throughout Home, tabular numerals, stronger sender names and counts, and sentence-case labels. No font or dependency added.

Keep the approved left-aligned hierarchy:

```text
Home / account / status
Changes since last visit
Suggested cleanup   | Attention / automations
Results             | Inbox Report insights
Mailbox snapshot
```

The primary cleanup panel gets the sole accent edge. Results and mailbox totals get clear surfaces; attention and insights remain quieter. This avoids giving every section an identical card or introducing decorative icons, charts, or gradients. Phone layouts stack and give Preview cleanup the available width. Larger numeric text makes the actual counts easier to scan; supporting provenance remains readable.

## Flow contract

Only presentation changes: typography, spacing, boundaries, neutral sender-link color, count badges, and the wrapper placing the existing preview button beside its existing helper. All reads, mailbox keys, limits, eligibility, labels, filters, callbacks, preview/confirmation, mutations and Undo owners remain unchanged. Home's development preview now uses the same app theme as production and truthful fixture-specific scan statuses. A long-name story exercises wrapping.

| State / transition               | Verification                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Populated authenticated Home     | Real local Next/API/PostgreSQL stack, 1,240 eligible synthetic messages across 3 senders; snapshot 1,243                        |
| Desktop / narrow phone           | Built-in browser, 1280px baseline and 320px phone; no horizontal overflow                                                       |
| Preview / cancel                 | Fresh 1,240-email preview; phone dialog left 0/right 320; Cancel initial focus; Enter cancels; focus returns to Preview cleanup |
| Empty / failed / error / loading | Development fixture route at 320px, same component and app theme; all fit                                                       |
| Light / dark                     | Primary, lower sections, snapshot and focus remain readable                                                                     |
| Results period                   | Existing controls and summary tests retained; fixture browser checked                                                           |
| Account scope / provider / Undo  | Behavior unchanged; existing regression tests remain; no provider operation attempted                                           |

## Verification and review

- Home plus preview-route tests: 142 passed. Independent reviewer ran another scoped set of 30 tests and ESLint.
- Repository typecheck and lint passed; six pre-existing unused-disable warnings remain.
- Production web build and all 49 route bundle budgets passed.
- Independent source and desktop/phone/dark capture review: no blockers. Fixture status advisories were fixed; no production data or safety finding.
- Browser logs checked for errors/warnings. No real mailbox actions, migrations, permissions, dependencies, API or data-collection changes.
- [Desktop](../qa/home-visual-sharpen-2026-10-25/desktop.jpg), [phone](../qa/home-visual-sharpen-2026-10-25/mobile.jpg), [phone totals](../qa/home-visual-sharpen-2026-10-25/mobile-totals.jpg), [dark phone](../qa/home-visual-sharpen-2026-10-25/mobile-dark.jpg). Synthetic local app data only.

Required remote CI and the normal merge queue remain release gates. This record does not itself claim a production deployment.
