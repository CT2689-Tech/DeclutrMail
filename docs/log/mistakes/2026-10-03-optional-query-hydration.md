## 2026-10-03 — Optional queries can settle before a route hydrates

**PR:** [#873](https://github.com/CT2689-Tech/DeclutrMail/pull/873)
**Caught by:** production browser smoke and controlled first-document sweep
**What happened:** Autopilot's streamed suggestions could settle after SSR but before the route's first browser render, producing different HTML and a recoverable React hydration error. The defect-class sweep reproduced the same mismatch from Chrome's shared cache in Screener's count and busy rows, Senders' first-cleanup nudge, and Triage's progress header. Primary content still appeared, so DOM readiness alone missed the subtree rebuild.
**Correct approach:** Preserve matching server and initial hydration markup for optional data, then adopt the existing query cache after hydration. Keep action guards on live job membership immediately; defer only presentation. Triage's progress position uses its existing layout-ready boundary.
**Rule:** For streamed or shared optional queries, test SSR followed by a cache update before hydrateRoot, require no recoverable hydration error, and verify the resolved content and live action locks afterward.
**Enforcement update:** Real route SSR-to-hydration regression tests, unchanged-cache controls, and Screener callback safety checks; no global error suppression.
