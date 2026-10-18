# Home Focus and account menu

The user compared two local Home prototypes and chose Focus with the compact account menu. This chat owns the Home presentation/loading/copy files, the account menu and their tests; it is the integration owner. There are no backend or other-PR dependencies. Existing open PRs do not change these surfaces.

## Flow contract

Returning users land on Home in the active Gmail mailbox. One ranked recommendation leads to the existing preview; opening or cancelling it never changes mail. The primary unsubscribe/archive preview retains its existing confirmation, quota checks, provider reconciliation and Undo. Report and Activity remain real navigation destinations. Account switching continues through the existing mutation and cache reset; the menu preserves targeted reconnect, data controls and inbox limits.

Only served recommendation counts and recorded progress appear. Missing email counts stay unknown; no sample avatars, sender identities, weekly totals or recent actions from the prototype become product data. The design changes no eligibility, scope, provider, privacy, billing or retention policy.

| State / transition                            | Visible behavior                                                 | Data / cache                | Verification                                                               |
| --------------------------------------------- | ---------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| Ready with recommendation                     | Focus lead, inbox impact count, preview, progress column         | Existing Home reads         | Unit + browser: distinct 138 current / 200 cleared                         |
| No recommendation                             | Calm next step with Report and recorded progress                 | No fabricated counts        | Unit + browser: second mailbox with 19 cleared                             |
| Unknown email count                           | Omit impact; review senders rather than open an unusable preview | No zero default             | Unknown / zero / NaN unit cases; Storybook                                 |
| Loading / error                               | Matching skeleton or named error/retry                           | Existing query behavior     | Unit + rendered 320px preview; no overflow                                 |
| First scan queued / syncing / failed          | Existing status and recovery                                     | Existing sync state         | Retained state tests + stories                                             |
| Open / cancel preview                         | Exact existing selection and cancel-first focus                  | No mutation before confirm  | Browser: Cancel starts focused; Enter cancels                              |
| Account menu open / close                     | Compact mailbox rows, one check, keyboard focus return           | Health reads only when open | Unit + browser + Axe; Escape restores trigger                              |
| Switch / switch failure                       | New account via server; retry remains available on failure       | Existing scoped cache reset | Failure unit case; two synthetic mailboxes switch and persist after reload |
| Disconnected / reconnect / deletion in flight | Existing status and targeted recovery/data controls              | Existing restrictions       | Retained unit cases; targeted data-controls dialog opened and cancelled    |
| Plan inbox limit                              | Existing add-account gate                                        | Existing entitlement checks | Retained account-menu entitlement tests                                    |
| Desktop / phone / keyboard                    | Lead before supporting detail; menu fits viewport                | Presentation only           | 1280 / 375 / 320px browser + Axe; light / dark visual checks               |

## Design

Keep the existing plum palette: canvas #1e1a21, surface #302a32, ink #f4edf1, muted ink #b8aab6 and accent #d1b8d6. Use registered light colors too. Fraunces carries the Focus headline and progress figure; Geist carries explanatory copy and controls. A broad recommendation sits beside a quiet progress column, followed by real report insights. Phones stack in reading order. Account identity remains visible; utilities follow mailbox selection.

The chosen design's distinctive feature is the single editorial recommendation. Supporting details must not become equal-weight metric cards. Production uses current data and existing action semantics, rather than promoting the disposable prototype directly. The comparison bar and losing variant were archived outside the checkout and removed.

## Evidence

The affected Home, account-menu and AppChrome suites pass 183/183 tests. Four new unknown-count / first-cleanup regression cases fail against the original Home view and pass with the implementation. The first recommendation now remains visible before any cleanup history exists, with the existing "Nothing cleared yet" progress message rather than a fabricated total.

Full monorepo typecheck, formatting, production web build, bundle/prerender budgets and Storybook build pass. Lint has zero errors and six existing unused-disable warnings. The isolated browser journey runs four cases: real first-cleanup preview and desktop/phone widths 1280, 375 and 320. Each viewport case verifies preview cancellation, focus restoration, menu bounds, Axe accessibility and no mail-changing action POSTs.

All four browser cases passed against both the development app and an optimized production web build. The production browser copy uses the same build-only lint/type skips as CI; the complete checkout separately passed the strict build, typecheck and lint. An initial temporary-copy type pass could not resolve an existing test's relative shared-package import, so no success was inferred from that attempt. The production runtime pass completed without skipped cases.

Manual checks use only disposable `@synthetic.test` mailboxes, a dedicated local Postgres/Redis pair and an app copy without inherited application credentials. There is no worker or provider credential. Recommendation impact (6 senders / 138 inbox emails) remains distinct from historical progress (200 cleared). Switching to a second mailbox shows its own 19 cleared and no recommendation; reload preserves selection. Per-mailbox data controls still target the named mailbox and cancel without changes. At 320px the menu is 296px wide, fits the viewport and retains 44×44 management targets. Loading, error and reconnect previews fit at 320px. Light and dark Home/menu appearances were inspected.

Independent source and visual review passed with no unresolved findings after correcting management touch targets, bounded loading placeholders and impact pluralization. First-cleanup and unknown-impact stories were added alongside the existing state matrix. Prototype-only comparison controls and the losing layout are excluded from product code.

Provider mutation and billing tests are excluded: this presentation change does not alter those boundaries, and no real mail was changed to manufacture evidence. Local verification is not production deployment proof; PR, queue and release states must be recorded separately.

## Production follow-up: metered header fit

PR #1051 merged through the queue at `aaac48f6f03070c1e706a6ca1f53772618fade7b`; its PR, queue and post-merge CI passed. Vercel production deployment `dpl_A4aDj7BQdZ3nQYQcZxydvq7RpbdZ` became READY and the authenticated production Home reported build `aaac48f`. The first-cleanup recommendation rendered with real served impact and no historical total.

That check found a missed combination: the Free quota text plus the wider avatar/caret crowded the narrow shell header. Document scroll width alone did not expose the clipped control. The follow-up keeps the full allowance on Home, hides the duplicate compact header allowance through 900px, and restores a 44px avatar trigger on phones. Its accessible email and expanded state remain intact. This chat owns the bounded shell wrapper/CSS, account-menu CSS and Home browser test; it depends only on the already-merged Focus change.

The browser matrix now covers Free and Pro at 1280, 768, 375 and 320px, plus first-cleanup cancellation: all nine production-build cases pass. Tests assert the account button's actual bounds as well as menu bounds, visible full allowance, keyboard behavior, Axe and absence of mail-changing POSTs. Local meter flags match the CI journeys lane. The 183 affected unit tests, full monorepo typecheck, lint and formatting pass. At 320px, manual Free-account inspection measures the trigger at left 260/right 304 with a 44×44 hitbox, and the menu at left 8/right 304. No production preference or mailbox mutation was used for this check.
