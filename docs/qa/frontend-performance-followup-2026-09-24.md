# Frontend performance follow-up — 2026-09-24

This follows the frontend items in `interaction-performance-2026-09-24.md`. Synthetic development measurements below are not production percentiles or browser layout/paint measurements.

## Implemented and reproduced

### Progressive sender detail

The inspector previously required detail, messages, monthly trend and decision history to all finish before showing identity, current inbox/archived counts or actions. Three deterministic deferred-response cases exercise each slow child independently: identity and archived counts now appear while that response is still unresolved. The outstanding section says it is loading, then displays its actual response. A failed history request preserves identity and offers a section-specific retry; it never says “Nothing decided yet” for unknown history. Existing authoritative child 404 handling remains in place.

Mailbox scope reset now causes a render directly instead of updating only a ref. This matters when a new result is structurally equal and query observers have no other reason to notify. Every child checks its own successful cache-update counter against the reset (including equal-clock updates); fresh identity cannot authorize a previous mailbox's history/messages/chart. Secondary data is read directly from the current query-derived model rather than waiting one effect frame for local optimistic state reconciliation. Tests cover successful and failed post-reset responses, stale sibling 404, and history awaiting refresh after identity succeeds.

The full-page server entry still hydrates all four first-page requests in parallel under the existing two-second deadline. The progressive improvement benefits the client inspector, cache misses and client recovery; it does not claim that full-page SSR no longer waits for secondary reads. Streaming that hydration requires an explicit boundary design to avoid duplicate client reads and stale hydration races.

### Long-list keyboard navigation

The keyboard handler previously queried every sender element across the entire document, allocated an array, then searched it for the next sender. It now queries the exact escaped ID inside its own list. Besides avoiding the temporary full-list array, it cannot accidentally scroll an unrelated surface with a duplicate sender ID. A regression covers list scoping, punctuation in IDs, and preserved nearest-row scrolling. Existing collapsed-group, range-end, typing and selection shortcut tests remain.

A repeatable opt-in benchmark is committed at `apps/web/src/features/senders/sender-list.perf.test.tsx`:

```sh
DM_RENDER_BENCH=1 pnpm --filter @declutrmail/web test src/features/senders/sender-list.perf.test.tsx
```

It renders synthetic rows through the real SenderList, exercises ten keyboard selections, asserts the active tenth row, and reports React Profiler render durations, total keyboard-handler/update duration, mount duration and DOM element count. It uses no mailbox content or network and is skipped in ordinary test runs. Durations are diagnostic observations without flaky CI timing thresholds.

| Loaded rows | DOM elements | Baseline mount ms | Baseline mean selection render ms | Baseline mean key/update ms | Scoped query mean key/update ms |
| ----------- | -----------: | ----------------: | --------------------------------: | --------------------------: | ------------------------------: |
| 50          |        1,102 |               166 |                              1.57 |                        3.64 |                            4.44 |
| 500         |       11,002 |             1,451 |                             11.21 |                       34.15 |                           17.20 |
| 2,000       |       44,002 |             5,208 |                             11.85 |                      103.65 |                           86.74 |

These are single development happy-dom runs on the same host; concurrent activity and JIT/GC introduce noise, so the table does not establish a production speedup percentage. The exact scoping/allocation reduction is structural. Memoization already keeps ordinary selection rendering much smaller than mounting. The large DOM and growing total event time make 2,000-row browser profiling a justified next step: record style/layout/paint and scrolling on desktop/mobile, then compare virtualization or content-visibility with group expansion, focus, checkbox range selection and keyboard scrolling. Happy-dom cannot settle that choice.

### Real-browser synthetic check

A temporary local Next.js route at port 3107 rendered the same real SenderList with synthetic rows only. Codex browser controls operated its visible benchmark buttons. The fixture measured ten keyboard selections, React Profiler render duration, and elapsed time through two animation frames; it exposed results in the DOM for inspection. The temporary route was removed after verification.

| Rows  | Mean React selection render ms | Mean key to two animation frames ms | DOM elements |
| ----- | -----------------------------: | ----------------------------------: | -----------: |
| 50    |                           2.83 |                               32.41 |        1,175 |
| 500   |                           8.19 |                               32.76 |       11,075 |
| 2,000 |                          10.78 |                               37.57 |       44,075 |

All ten selections committed at every size; 2,000-row scrolling remained functional and browser error logs were empty. Two animation frames impose a roughly 33ms floor here; this measures a consistent readiness proxy, not input delay or a production interaction percentile. Repeating 2,000 rows with the original keyboard handler yielded 10.31ms render / 38.49ms through two frames. That difference is within measurement noise: do not claim a real-browser speedup from the scoped query. Keep its bounded element lookup and isolation correctness; the browser evidence does not justify shipping virtualization yet. A production-build mobile CPU/layout trace and long-list initial mount assessment remain useful follow-ups.

## Reviewed areas and remaining measurements

- **Main navigation:** app chrome already calls `router.prefetch` on destination intent; shell tests cover pointer intent and mobile touch. The parent task owns cold/warm authenticated route smoke. Do not add indiscriminate destination prefetch: it increases API fan-out.
- **Initial authenticated load:** `ServerAppBoundary` resolves cached session state, then starts onboarding, account-deletion, sync status, Later recovery and undo reads in parallel. Optional counts are already client-owned. `settleServerQueries` logs privacy-safe surface, duration, query count, failures and deadline counts, and enforces a two-second deadline. Separate session timing and production traces are still needed before moving safety-sensitive reads outside this boundary; current logs exclude time spent before settling begins and are not an auth timing breakdown.
- **Bundles:** route budgets cover every manifest route. The new progressive states add no dependency or additional request. Keep the existing lazy inspector and package import optimization; further splits need chunk inspection against a production build. Parent integration should rerun the budget check because simultaneous changes may affect shared chunks.
- **Images:** Avatar uses same-origin CSS backgrounds only for known available brands on sender rows, keeps a zero-JS monogram base, and skips tiny marks. CSS backgrounds are not lazy images; do not replace them casually with an `img` whose failed load obscures the monogram. Measure visible/offscreen logo requests and bytes on the same long-list browser profile before changing loading behavior.

## Validation

- Detail and pane suites: 68 tests passed (includes three delayed-child cases, child retry and reset-generation regression).
- Sender list suite: 9 tests passed.
- Opt-in synthetic benchmark: all three row counts passed.
- Web typecheck and lint passed. Production build and all 52 route bundle budgets passed before the cache-generation hardening follow-up; the parent task will rerun combined checks.
