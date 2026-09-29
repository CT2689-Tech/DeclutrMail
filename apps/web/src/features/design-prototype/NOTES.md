# DeclutrMail design study

Question: which visual system best communicates a capable, calm Gmail companion across Overview, Sender Details and the public homepage?

Two deliberately distinct directions:

- **Editorial:** warm paper, forest navigation, serif hierarchy, spacious sender workspace.
- **Precision:** cool surfaces, cobalt accents, top navigation, aligned table and inspector.

This is a development-only, throwaway comparison. A separate route is intentional: it compares both the authenticated application shell and public marketing surface, which have different existing layouts. Production pages, authentication, action handlers and shared production tokens remain unchanged. It is not linked from public navigation or the sitemap and is server-gated with `notFound()` in production.

## Run and compare

From this branch's worktree:

```sh
pnpm --filter @declutrmail/web dev -p 3000
```

Open `/design-prototype?variant=editorial&view=overview` or `/design-prototype?variant=precision&view=overview`.

Use the floating comparison bar to switch direction, screen, or theme. Direction keys also work with left/right arrows when focus is outside interactive controls. Query parameters (`variant`, `view`, `theme`, `detail`) survive reload; simulated mailbox changes do not.

## Implemented interactions

- Overview, Sender Details and full homepage for each direction.
- Light/dark themes and responsive layouts.
- Sender selection and search. Editorial also has All / To review / Protected filters.
- Editorial standalone detail composition; Precision expanded inspector.
- Independent Protect/Unprotect sample state.
- Reuses the production `ConfirmActionModal` for Archive, Unsubscribe, Later and Delete, including protection overrides, scope, age, matching examples, and focus management. Keep records immediately, as in production. Informational dialogs remain native.
- Dated sample messages drive matching counts and examples. Unsubscribe defaults to Leave alone, with Archive them / Delete them secondary actions. Delete supports Inbox only / Inbox + archived. Age options are All, 30 days+, 3 months+, 6 months+, 1 year+. Standalone Delete defaults to 6 months+; unsubscribe cleanup defaults to All. Archive stays inbox-only.
- Undo restores the latest cleanup to each message’s previous location, preserving independent protection changes. Composite cleanup Undo explicitly does not recall unsubscribe. A subsequent action replaces the latest recovery control.
- Sample reset. Marketing calls to action enter the sample workspace.

All names, addresses, subjects and snippets are fictional. The sample date is September 21, 2026; Later uses the production default of seven days from now and future-only local date/time validation. `recent` and marked-read percentages use 90 days; trend values illustrate weekly volume over 12 weeks. Historical sender totals do not change when mail leaves Inbox.

No Gmail API, billing API, account mutations, mailbox storage, new analytics, or persistent browser storage is used by the study. Actions complete immediately in memory: these are interaction simulations, not a replacement for production's queued/worker-confirmed lifecycle. Other navigation destinations explain that they are outside this comparison. Production preview and action semantics remain the implementation source of truth. Fixtures model one-click unsubscribe only: mailto/manual methods, bulk selection, quota, queue failures, and Activity history are not represented. Sample recovery is a latest-action control, not a persisted 30-day Activity timeline.

## Verification

- Web typecheck and scoped ESLint/Prettier checks.
- Browser inspection of both directions and their three surfaces; 320px mobile overflow checks across all six, plus 390px mobile and 1280/1440px desktop spot checks.
- Dark theme inspected in both sender workspaces.
- Sample Archive → Protect → Undo preserves protection and restores inbox count.
- Search and expanded details, Later date/time preview, Escape focus return.
- Browser logs checked for errors/warnings.
- Production confirmation + sample-ledger tests: 123 passed. Added production route-gate tests and bounded route attribution verification.
- Browser verified unsubscribe + delete with all-mail reach and 6-month age: 96 matching emails, followed by recovery of original locations and explicit unsubscribe caveat.

## Decision

Pending founder review. No winner selected. Production integration should reimplement the chosen patterns using existing components, real read models and canonical action lifecycle, with appropriate behavior tests and stories. Remove the losing direction and this route after the design question is resolved.

## Homepage and color study (September 2026)

Question: does a richer, more product-forward homepage and a different brand hue improve the first impression without losing the calm editorial feel?

The visual study compared Editorial stage, Product first and Guided story with Plum, Cobalt and Forest palettes in light and dark themes. The founder selected Editorial stage with Plum. The selected direction is now on the public homepage and shared theme, including the brand mark, icons, social previews, sign-in and product shell. The throwaway homepage study route and the unselected variants were retired after the production page was verified.

## Hybrid layout review

Editorial sender workspace now combines the warm visual system with a sticky right-hand inspector above 760px. Sample search, high-volume (75+ inbox), low marked-read (<20% over 90 days), protected filters, minimum inbox volume, and sorting work locally. Checkboxes preserve selection across filtering and explicitly indicate hidden selections. The bulk toolbar is a placement preview only and opens a labelled explanation, without executing actions. Production screens are untouched. Browser verified filter counts, multi-selection, switching the inspector to Orbit, and mobile overflow at 390px. Awaiting layout review before production integration.

## Comparable sender functionality

Both visual directions now render shared sender filter/sort/bulk controls and use one workspace state owned by the comparison shell. Search, presets, minimum inbox volume, sorting, selection (including hidden selections), and inspected sender persist across direction changes. Both expose all five single-sender actions, protection, three sample messages with snippet dialogs, and expanded details. Bulk actions remain the same explicitly labelled layout-only simulation in both. Verified direction switching with High volume and two selected senders, plus Precision mobile fit at 390px. Typecheck and scoped lint pass.

## Compact Editorial refinement and growth rules

The Sender workspace now separates discovery (search/presets/More filters), sender evidence (scrolling inspector body), and decisions (stable action footer). Detailed filters stay collapsible, while applied volume criteria remain removable outside the disclosure. Both directions retain matching filter functionality. Bulk selection reports protected exclusions and its toolbar sticks while scrolling.

Future additions should follow these slots: new filter criteria inside More filters; frequently reused criteria may earn a preset after validation; new sender evidence belongs in labelled inspector sections; uncommon actions belong in a secondary menu rather than more primary buttons. New top-level navigation is reserved for distinct recurring workflows. Preserve the same spacing, surface, typography, focus, and semantic color tokens. Do not add placeholder product tabs or inactive future features. Large new workflows still require responsive and behavior review; this structure is not a guarantee of unlimited capacity.

This remains a local visual study, with bulk execution explicitly disconnected. No production implementation or deployment is authorized by the visual review alone.
