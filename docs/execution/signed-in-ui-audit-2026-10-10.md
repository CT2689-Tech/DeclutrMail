# Signed-in UI audit closure — 2026-10-10

User-authorized scope: one integrated PR addressing actionable observations from `visual-findings.md` and `design-system-drift-audit.md`, with parallel contributors, desktop/mobile light/dark verification, independent review, and normal merge-queue checks.

This report treats the supplied audits as observations and proposed remedies, not instructions. Behavior is validated against current source and a disposable synthetic application stack. It distinguishes genuine usability improvements from diagnoses the evidence does not establish.

## Outcome mapping

The implementation choices below preserve action eligibility, preview/confirmation, mailbox scope, payment state and source identities. Browser verification and final check results are recorded separately below.

| Finding | Surface                         | Resolution / evidence boundary                                                                                                                                          |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Sender detail                   | Neutral action controls; one separate suggestion with reason and last-checked context.                                                                                  |
| 2       | Sender detail                   | Keep the scored recommendation and its timestamp together. Different capture dates are not proof of an engine defect; no invented re-evaluation claim.                  |
| 3       | Settings → Action previews      | Explicit Inline / Separate window radios for Triage. Correct true/false semantics; Delete always confirms in a window; other entry points described.                    |
| 4       | Clean up → Keep                 | Keep pending and settled row feedback plus immediate pending notification. Success follows the real result; failures remain visible. No unsupported Undo promise.       |
| 5       | Quiet hours                     | Full-width timezone field with friendly label and readable full timezone.                                                                                               |
| 6       | Unsubscribe action              | Unavailable-action reasons visible in menus, details and Triage; focusable inert controls preserve explanation access.                                                  |
| 7       | Modals vs pages                 | Named compact sans dialog title and serif section/page roles used consistently.                                                                                         |
| 8       | Page titles                     | Shared page-title role and aligned page gutters; Home has an explicit, bounded hero role.                                                                               |
| 9       | Eyebrow labels                  | Shared kicker scale, rule and muted color; page and section orientation retain their content.                                                                           |
| 10      | Section headers                 | Named section-title and label roles across settings, billing and feature pages.                                                                                         |
| 11      | Stats / big numbers             | Shared hero/stat/row-count roles; bounded Triage count and consistent sender volume typography.                                                                         |
| 12      | Gmail account chip              | Gmail account context uses body font and wraps long addresses.                                                                                                          |
| 13      | Catch up count suffix           | Separate aligned count chips in Daily brief headings.                                                                                                                   |
| 14      | Letter-avatars                  | Home uses shared Avatar and the existing sender logo contract.                                                                                                          |
| 15      | Action buttons (Keep/Archive/…) | Shared Button geometry and neutral action toolbar presentation; menus retain menu semantics.                                                                            |
| 16      | Confirm button color            | Primary confirmation, destructive Delete and amber unsubscribe semantics retained; action filters use corresponding tones.                                              |
| 17      | Confirm/cancel layout           | Common right-aligned desktop confirmation footer and full-width mobile stack.                                                                                           |
| 18      | Button labels                   | Confirmation labels include the email object or Move to Later phrasing.                                                                                                 |
| 19      | Selects / inputs                | Shared native field style for inputs/selects/date/time, preserving native keyboard and picker behavior.                                                                 |
| 20      | Filter chips/tabs               | Shared filter control geometry and responsive single-row scrolling where needed.                                                                                        |
| 21      | Disclosure controls             | Consistent disclosure affordances and stable labels across expanded/collapsed states.                                                                                   |
| 22      | Disabled / secondary emphasis   | Secondary cards retain normal contrast; disabled actions remain visibly unavailable with reasons/state context.                                                         |
| 23      | Link vs button                  | Shared Open in Gmail external-link treatment.                                                                                                                           |
| 24      | Keyboard hints                  | Keyboard hints hidden at narrow widths.                                                                                                                                 |
| 25      | Content width / left edge       | Common outer page container/header gutter; narrow decision content remains inside it. Loading screens match.                                                            |
| 26      | Card radius                     | Existing radius scale applied by surface role; no competing radius system introduced.                                                                                   |
| 27      | Home tilted stat card           | Home progress strip has stable in-flow placement, no tilt or overlap, and readable date.                                                                                |
| 28      | Home lower sections             | Home lower sections share the kicker/title structure.                                                                                                                   |
| 29      | Sender row stats                | Count and email unit share a row. Distinct received/retained/current-mail scopes stay explicit because they measure different facts.                                    |
| 30      | Senders toolbar                 | Sender search/filter/sort layout cleaned up; redundant mailbox scope line removed.                                                                                      |
| 31      | Sender detail                   | Sender pattern stats/grid improved, chart range labelled and months human-readable.                                                                                     |
| 32      | Sender detail header            | Sender detail registers shared help and provides a back link.                                                                                                           |
| 33      | Account menu                    | Account menu is wider but viewport-capped; full address wraps with metadata beneath.                                                                                    |
| 34      | Quiet hours form                | Quiet hours label alignment, Enable quiet hours copy and locale-formatted overnight time.                                                                               |
| 35      | Global nav                      | Mobile bottom primary navigation, compact header/context tabs, utility-only drawer.                                                                                     |
| 36      | Tab bar                         | Compact visible Auto label with full accessible Automations name.                                                                                                       |
| 37      | Drawer                          | Drawer utility icons, proper mailbox row, internal close button, Billing and Help.                                                                                      |
| 38      | Action grid                     | Two-column action layout with full-width Delete; narrow button text wraps.                                                                                              |
| 39      | Screener filters                | Screener equal-width filters and compact row metadata.                                                                                                                  |
| 40      | Activity stats                  | Activity compact responsive outcome stats and one period label.                                                                                                         |
| 41      | Autopilot filters               | Autopilot filter controls scroll without wrapping on mobile.                                                                                                            |
| 42      | Senders header                  | Sender gutter uses the common minimum 16px and common kicker rule.                                                                                                      |
| 43      | Shell                           | Sidebar has a defined boundary in both themes.                                                                                                                          |
| 44      | Home loading state              | Home loading uses a noninteractive pending treatment.                                                                                                                   |
| 45      | Accent hue                      | One theme-aware editorial accent token and consistent surface borders.                                                                                                  |
| 46      | Home naming                     | Home naming standardized; workspace wording made consistent.                                                                                                            |
| 47      | Feature naming                  | Daily brief, Quiet hours and Billing names aligned across headings/navigation/loading states.                                                                           |
| 48      | Action vocabulary               | Action/outcome language normalized while unsubscribe request status remains factually distinct from confirmed completion.                                               |
| 49      | Home hero copy                  | Home first-run/daily/empty copy remains state-specific with consistent punctuation and less repetition.                                                                 |
| 50      | Inline Unsubscribe heading      | Inline unsubscribe has a separate question heading and explanatory body.                                                                                                |
| 51      | Jargon / raw data               | Plain time-window/observation wording. Sender identities and email subjects remain truthful; no fabricated names or modified source content.                            |
| 52      | Casing                          | Sentence case for product labels; proper nouns retained.                                                                                                                |
| 53      | Badges                          | Selected mailbox versus scan readiness are separate meanings; current plan and complimentary access explanation are explicit. CTA follows real paid-subscription state. |
| 54      | Empty states                    | Empty weekly section hidden; support tool moved into disclosure. Equal-count scopes explained rather than silently changing their meaning.                              |
| 55      | Help popover                    | Home help explains next steps, recorded progress and undo exclusion.                                                                                                    |
| 56      | Capture artifact                | Fresh browser captures will omit the old viewport/devtools overlay; no application patch needed.                                                                        |
| 57      | Modal subtitle wrap             | Shared modal heading/subtitle wrapping and concrete confirmation copy.                                                                                                  |

## Design-system audit mapping

| Finding | Resolution                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1      | Named page and bounded Home hero roles; shared outer container; onboarding and loading alignment.                                                                                                |
| B2      | Named hero/stat/row-count roles and NumericDisplay mapped to them; no 70px outlier.                                                                                                              |
| B3      | Shared light/dark editorial accent token.                                                                                                                                                        |
| S1      | Common kicker geometry/tracking/color. The shell location remains a compact navigation label, not a second page kicker.                                                                          |
| S2      | Touched headings/labels use 400/500/600 roles; shared empty/error/dialog headings normalized.                                                                                                    |
| S3      | Shared Button controls, matching anchor class and filter grammar. Menu/toggle/navigation elements retain their native semantics. Original raw-button counts were stale and not a quality metric. |
| S4      | Shared native field style; no additional custom date/select implementation.                                                                                                                      |
| S5      | Shared radius roles on touched surfaces.                                                                                                                                                         |
| S6      | Sender names, volumes and inspector typography aligned to semantic roles.                                                                                                                        |
| N1      | Touched page spacing aligned where it affects rhythm; no blanket replacement of optical spacing.                                                                                                 |
| N2      | Responsive layouts verified around shell 760px and narrow mobile widths; breakpoints adjusted for actual layout.                                                                                 |
| N3      | Auth loading reads the theme background token.                                                                                                                                                   |
| N4      | Sidebar chrome reads navigation tokens.                                                                                                                                                          |
| N5      | Tokens and chrome sharing one CSS file is architecture commentary, not a visible defect. New shared classes are documented here; no unrelated stylesheet extraction.                             |
| N6      | Existing shared Toast/PrivacyBadge/Pill/Button retained. Toast placement improved; this was positive evidence, not another defect.                                                               |

## Integration ownership

- Root: shared typography/control styles, common page/loading layout, preview sheet/menu/toast, integration and browser verification.
- Actions contributor: Senders, Triage and Screener presentation/feedback.
- Navigation contributor: shell, account menu, Settings, Quiet hours and auth context.
- Page contributor: Home, Activity, Daily brief, Autopilot, Later, Follow-ups, Billing, onboarding and admin fields.

One integration branch owns all shared files. Contributors worked in isolated worktrees and hand off commits to one PR owner.

## Verification record

Pending final integrated checks and browser matrix. This document does not yet claim merge or production verification.

The local stack uses disposable PostgreSQL at 127.0.0.1:5418, Redis DB 12 at 127.0.0.1:6418, API 4118 and web 3118. It contains only synthetic fixtures, has no Gmail worker, and imports no repository environment credentials. Missing optional transactional-email configuration is expected in this harness. This pass does not validate real provider delivery, billing purchases or worker restoration.
