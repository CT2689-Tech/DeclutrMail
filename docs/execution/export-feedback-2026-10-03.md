# Privacy data export audit — 2026-10-03

## Flow contract and ownership

Returning-user Settings → Privacy & data → select JSON or a dataset CSV →
preparation → complete blob → browser download handoff → return to work or retry.
The existing endpoint exports selected account datasets across connected inboxes;
it does not promise a complete account export. Authentication refresh/replay,
format definitions, privacy/retention, and server rate limits remain authoritative.
Onboarding, billing and real mailbox mutations are excluded.

Root owns the export hook, Privacy & data view/stories/tests, the export regression
in `a11y-smoke.spec.ts`, event documentation/comments and this record. Root is the
integration owner. Isolated branch `codex/export-feedback` starts at `2ff2aa44`.
No runtime event schema, dataset contents, dependency, API or storage change. Concurrent
Autopilot work (#867) owns separate files; no dependency on that PR.

## Findings and repairs

- **P2 — incorrect recovery advice.** Every export failure blamed rate limits.
  Confirmed HTTP 429 retains wait advice; terminal 401 offers sign-in guidance;
  server/network/stream/unknown failures offer retry and the existing support path.
  Arbitrary error strings or status-like objects cannot manufacture a diagnosis.
- **P2 — no preparation confirmation.** A successful export produced no visible
  feedback. A persistent, atomic status region now names the prepared dataset and
  points to browser downloads. It does not assert that the file was saved.
  New pending/error attempts clear previous confirmation. Revisit resets it;
  client handoff is not a durable receipt.
- **P3 — phone control sizing.** Export buttons measured 36 pixels high. They now
  retain their compact labels/widths with a minimum 44-pixel touch height.
- **P3 — indistinguishable fallback CSV filenames.** A cross-origin browser test
  reproduced the generic filename used when `Content-Disposition` is unavailable.
  Senders and Decisions fallbacks now match the API's dataset-specific names.
  Available server filenames still win; no CORS/security policy changes.
- **P3 — misleading analytics documentation.** `data_export_requested.success`
  means a full blob reached the browser download mechanism. Documentation formerly
  claimed the blob was saved and omitted the two dataset-specific CSV formats.
  All four formats and the diagnostic limits of the shared failure outcome are
  now documented. Existing consent-gated, best-effort telemetry is unchanged.

## Verification

The added view regressions ran against the old view before implementation:
three failures reproduced misleading recovery advice and absent confirmation.
Two further regressions failed against generic dataset fallback filenames.
The corrected focused view, export lifecycle and authentication-replay suites
pass **33/33**. Tests establish that the handoff and one success event occur only
when the complete blob resolves; HTTP 429/500, rejected fetch and failed streams
produce no handoff and one failure event. The existing refresh/replay behavior
remains covered. A same-node rerender test proves the live region exists before
its message changes and clears during a new attempt.

Full `pnpm typecheck`, `pnpm lint` and production Storybook build passed. Lint has
six existing unused suppression warnings. An independent flow reviewer caught the
initially mounted-and-populated live-region problem; the persistent region and
regression resolve that blocker. Source, privacy, design-system, TypeScript and
React review are cleared. The filename follow-up also received independent review
and three targeted filename regressions passed independently.

Synthetic Storybook checks covered prepared, generic failure, rate limited,
unauthenticated, pending and no-mailbox states. At requested 390 × 844, Storybook's
actual content viewport was 380 pixels wide with no horizontal document overflow;
all four controls measured 44 pixels high. This is component evidence, not a claim
about a deployed production export or every browser's screen-reader announcement.

The required desktop and reduced-motion phone accessibility lane includes a
synthetic browser regression for keyboard activation, HTTP 500/429, network failure,
retry, pending controls, complete fixture bytes downloaded, prepared status,
re-enabled controls, accessibility and revisit. Export requests are intercepted
with synthetic data; the test does not export production mailbox content.
The final isolated run executed both desktop and reduced-motion phone projects:
**2/2 passed**, including exact saved fixture bytes and dataset fallback filename.
The initial browser run failed at the fallback filename assertion and led to the
additional repair; no failing check was ignored.

## Remaining boundaries and opportunities

A prior production Senders CSV attempt recorded a client handoff event, but the
in-app browser download waiter timed out. Saved-file receipt for that production
account remains unverified; an automation timeout alone does not prove a product
failure. This repair does not change object-URL timing on that hypothesis.

A durable export receipt/history could help users find a past file, but it requires
a defined storage/retention policy and a reliable saved-file boundary. The current
client cannot establish that the user saved a file. No new collection is introduced.

Production Sentry fetch failures, authenticated PostHog insight usability, alert
receipt rehearsal and unavailable cost sources remain separate work tracked in the
returning-user audit. No production alert or Gmail mutation was sent for this fix.
