# Home refinement

Owner: this Codex chat; isolated branch `codex/home-refinement-20261024`, base `ce32398ba`. Own Home view/styles/loading/stories, a bounded Home sender-identity hook and affected tests. Dependencies: existing report and sender-detail APIs only; no overlap with open PRs, no backend/shared token/billing changes.

Design: preserve light card #ffffff, ink #2b2730, primary #6f568a; dark card #302a32, ink #f4edf1, primary #d1b8d6. Existing Fraunces carries the recommendation at 32–40px; Geist keeps sender names, impact and action compact. Use a narrower, left-aligned composition with the recommendation on the left and up to three real sender identities on the right; stack naturally on phones. One quiet primary-color edge provides emphasis. No new palette, decorative illustration, animation or repeated explanation.

```text
Home / active account
┌────────────────────────────────────────────┐
│ 50 senders worth        [FF] Fresh Finds    │
│ reviewing.              [MD] Meadow Mail   │
│ 1,200 inbox emails.     [NL] North Letter  │
│ [Preview cleanup]                          │
└────────────────────────────────────────────┘
> Details
```

Brief review: this keeps the requested TLDR hierarchy and adds personality through the existing display type and actual sender identity, instead of filling the page with new sections. The existing dark palette remains intact. The impact is the current report's inbox-email estimate, never a success or storage-saving claim; the mandatory live preview remains authoritative.

Flow: signed-in Home → one recommendation → fresh scoped preview → confirm → existing shared progress/terminal/Undo. This change affects only discovery. Preview, mutation, protection, quotas and lifecycle policy stay unchanged. Details keeps history, arrivals, report facts and alternate destinations. No provider actions or live mailbox writes for verification.

| State / transition                       | UI                                                                          | Cache / verification                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Ready / first cleanup                    | Strong heading, one impact line, up to 3 actual suggested sender identities | Bounded parallel detail reads under mailbox-qualified display-only keys |
| Missing / partial identity reads         | Omit unavailable identities; primary action remains usable                  | No previous-mailbox placeholders; optional reads do not retry           |
| No/zero/unknown impact                   | Omit impact; existing safe review fallback                                  | No invented zero or success                                             |
| Report/suggestion changes                | Only matching current sender IDs render                                     | Query key includes sender ID and mailbox                                |
| Account switch with reads in flight      | Old identities disappear; existing keyed Home resets dialog/Details         | Explicit mailbox header + query cancellation; test race                 |
| Loading, empty, syncing, error/reconnect | Existing recovery; updated skeleton geometry                                | Existing tests + browser fixtures                                       |
| Preview cancel/confirm/accepted/Undo     | Existing live preview and shared owner                                      | Existing regression tests; browser cancel only                          |

Exclusions: onboarding, billing, backend/schema changes, new sender data collection, provider mutations, performance claims. Larger Home dashboard expansion remains out of scope.

The identity query family is deliberately outside the awaited action/Undo rebuild families. A pending name must not latch the tray or get refetched every 400ms while a report rebuilds. Report IDs still own membership; the live preview owns confirmation. Existing global mailbox reset cancels/invalidates all families.

Verification: 130 Home tests and 953 shared tests pass, including exact-ID/mailbox isolation, partial identity failures, late-account responses, and the real Undo refresh with a pending optional name read. Negative controls fail when identity membership filtering is removed or the optional key is moved into the awaited sender family. Workspace typecheck, lint (six existing warnings), Storybook, production web build, all 49 route bundle budgets and prerender checks pass. Required-check/merge-queue policy audit passes.

Built-in-browser smoke used an isolated synthetic mailbox with 3 senders and 13 inbox messages, no worker or provider credentials. Verified dark desktop, light 375px phone, closed Details by default, one impact line even when expanded, keyboard Details, live preview resolving to 13, and Cancel returning focus to Preview cleanup. Long sender text truncates without page overflow; browser console has no errors. Screenshots are synthetic and contain no real mailbox data. No cleanup was confirmed. Independent source review found no actionable issues.
