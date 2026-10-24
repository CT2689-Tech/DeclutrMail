# Onboarding light-mode choice outlines

Relates to D110 and D210.

## Scope and ownership

This chat owns the onboarding choice styles, the app-only light stylesheet,
and the new isolated browser fixture/spec. The change has no dependencies on
other open PRs and does not edit shared tokens, public pages, dark-mode rules,
selection handlers, requests, submission state, or workflows.

## Problem and result

Light mode intentionally removes card elevation with `--dm-shadow-card: none`.
The goal and preset buttons combined their selection ring with that shadow in
one list. A ring followed by `none` is an invalid shadow list, so the selected
ring disappeared. Unselected white cards also merged into their white parent.

The existing buttons now accept two narrowly scoped style properties. App
light mode gives choices a one-pixel inset edge; selected choices have a
two-pixel purple ring and pale lavender fill. The selectors use the existing
route marker and exclude dark mode. In every other context, the inline
fallbacks reproduce the original background and shadows. Geometry, native
focus outlines, accessibility state, local selection, and submission stay intact.

## Verification

- All 175 onboarding tests passed across 15 files.
- All workspace type checks passed. Lint passed with zero errors and six
  existing warnings. Formatting and implementation-log checks passed.
- The production web build, all 49 route bundle budgets, and all 32 static
  public-route prerender checks passed.
- Built-in-browser smoke exercised both actual onboarding components at
  measured widths of 320, 375, and 1280 pixels in light and dark modes.
  Selected goals and presets retained their rings, unselected choices had
  visible edges in light mode, and no uncontained horizontal overflow appeared.
  Keyboard selection and moving focus away retained the chosen appearance.
  Dark mode kept its original charcoal cards and lilac multi-part shadows.
- Six browser regression cases cover goal switching, preset selection and
  deselection, selection after focus moves to Continue, default/explicit light,
  theme restoration, and pixel equality with the app stylesheet inactive in
  dark and public contexts. They run in the existing component-paint CI lane.

The fixture uses actual components and the actual preset catalog, synthetic
query data, and isolated telemetry boundaries. It does not submit onboarding,
connect an account, change a mailbox, or contact a billing provider. Manual
appearance evidence is local synthetic evidence, not a completed real-user
production onboarding claim.

## Review

Manual review against the frontend-design guidance, React checklist, and the
repository's design-system structural checklist found no blocking issue.
No new runtime component, state boundary, mutation, copy, motion, or API contract
was introduced. The test entry point is not imported by application routes.
The existing route marker and dark exclusion contain the CSS overrides, and
the original inline values remain the fallback outside those overrides.

Full required PR and merge-group checks remain prerequisites for merging.
