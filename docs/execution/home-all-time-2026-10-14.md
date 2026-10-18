# Home progress and Activity range

## Scope and ownership

This chat owns the Home progress presentation, its Activity links and the related
copy/tests/stories. It is the integration owner. There are no backend, schema,
provider or other-PR dependencies.

## Flow contract

Home already requests all-time recorded progress. Returning users should see
"All time" with that total and open Activity with the same range selected through
"See your activity". Both the ready progress and first-cleanup link use
`/activity?window=all`. Activity's default range at other entry points stays intact.

The ready period label does not depend on the nullable earliest-action timestamp.
Counts, mailbox scope, loading/error/empty states and the action lifecycle retain
their existing behavior. Provider mutations, billing and account settings are
outside this change. No real mail is changed for verification.

## Verification

- Negative control: the updated progress and link assertions failed three cases
  against the original component, then passed with this change.
- Home: 120 tests passed. Shared launch copy: 18 tests passed.
- Full workspace typecheck passed. The initial attempt overlapped Next development
  startup resetting generated route types; the completed rerun passed.
- Full lint passed with six pre-existing unused-disable warnings and no errors.
- Built-in browser: the actual local fixture Home rendered "All time" and the
  all-time link at 1280, 375 and 320 pixels without horizontal overflow. At 375px
  the link retained a 44.8px tap target. The focused progress block was visually
  inspected at 320px. No browser console errors were observed.
- Independent source review found no blocking React, design-system, copy,
  accessibility or sibling-flow issues. Both Home entry points and the decided-
  sender fallback were checked. Existing Storybook states use the updated view.

Local fixtures verify the changed presentation and link destination; authenticated
production navigation is a separate post-release check. Private screenshots remain
outside the repository. PR, required checks, merge queue and deployed behavior are
recorded separately in delivery evidence.
