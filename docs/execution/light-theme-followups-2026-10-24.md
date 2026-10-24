# Light-theme headings and mobile Automations follow-up

## Scope and ownership

This follow-up fixes two findings from the signed-in production appearance
review. This chat owns integration of the app-only theme stylesheet, the
Automations route container, and their existing browser fixtures/specs. There
are no dependency, API, schema, workflow, shared-token, or public-site changes.
PR #1115's Billing work is independent; this change does not edit Billing.

## Result

- The app's light-mode heading rule overrides the regular weight supplied
  inline by existing editorial roles. Page and section headings now use the
  intended semibold weight. The route marker and light-mode selector still
  contain the rule; dark and public typography keep their original styles.
- Automations uses a shrinkable single grid column. Expanding Preset rules
  no longer makes the sender library and presets wider than the phone. This
  sizing correction works in either theme without changing their palettes,
  rule controls, confirmation gates, or state handling.

## Evidence before and after

The real Automations route, rendered with synthetic server data and its
existing sender-rule transport fixture, reproduced the production defect:
expanded content reached x=539 in a 375px viewport while the clipped document
itself stayed within the viewport. This is why document-width checks alone
missed the issue. After the grid correction, the same child-bounds check
reported no escaping elements at 320px, 375px, and 1280px in light and dark.
The built-in browser showed semibold Geist preset headings in light mode and
the original regular Fraunces headings in dark mode. No browser errors were
captured. Only disclosure/navigation controls were used in this smoke.

## Verification

- 127 focused tests passed across the Autopilot screen, route hydration, API
  rollout recovery, and sender-rule library suites.
- The existing light-theme paint test now reproduces regular inline h1/h2/h3
  weights. It checks the semibold app override and the original public/dark
  weights, retaining its pixel-equality checks with the app stylesheet inactive.
- Six new browser cases exercise the real collapsed/expanded route at
  320px, 375px, and 1280px in both themes. They check child bounds as well as
  document width, and confirm collapse still works. These cases run in CI's
  existing component-paint lane.
- Built-in-browser smoke used the same production component fixture at all
  six viewport/theme combinations. This is local synthetic evidence, not a
  production verification claim.
- Production build, all 49 route bundle budgets, and 32 public prerendered
  routes passed. Formatting, lint (zero errors; six existing warnings), all
  workspace type checks, and implementation-log checks passed. Full release
  checks and normal merge-queue validation remain required before merging.

## Review

Manual review against the repository's frontend structural checklist and Web
Interface Guidelines found no blocking issues in the change. Native details
disclosure, focus behavior, preview-before-mutation controls, and server-state
ownership are unchanged. The new fixture cache data is synthetic and confined
to a test entry point that the application does not import. No new component,
motion, copy, or interaction pattern was introduced.

No real Gmail operation, sync, billing operation, or account connection is
part of this verification. Serving-state and signed-in production verification
must be reported separately after merge.
