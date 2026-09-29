## 2026-09-29 — A UTC-default render disagreed with a local-anchored test fixture for several hours a day

**PR:** [#764](https://github.com/CT2689-Tech/DeclutrMail/pull/764)
**Caught by:** self, re-verifying #764 after merging origin/main (adopting an
orphaned PR) — reproduced identically against #764's own pre-merge tip, so the
merge did not cause it
**What happened:** `fixtures.ts`'s `fixtureDaysAgo()` anchors to LOCAL calendar
midnight + 9am, with a comment claiming the instant is "unambiguously inside
that calendar day in any timezone the value is later read back in." #764 made
`TriageRowExpanded`'s "Last seen" stat zone-explicit, defaulting to `'UTC'` when
no zone is passed (the public-simulator case) — and `triage-row.test.tsx`'s
`renderRow()` never passed one, so every rendered assertion in the file went
through that `'UTC'` default. The claim held for the OLD ambient-`Date`
`daysSince` (both the fixture's local anchor and the render's `now` read the
SAME machine-local zone, so they could never disagree) but not for the NEW
explicit-zone one: comparing a local-9am-anchored fixture against a `'UTC'`
"now" disagrees for part of every day in any zone behind UTC — specifically
once local evening has already crossed into the next UTC calendar day.
Reproduced deterministically at 23:5x PDT (`America/Los_Angeles`,
UTC-7/UTC-8): `TriageRow expanded — quiet-90d rows never read "LAST SEEN
today" (W3) > still shows "today" for a sender whose window has recent
messages` failed with "1d" instead of "today", passed again at other hours.
Passed in CI throughout, because GitHub-hosted runners default to UTC, where
local and UTC are the same zone and the fixture's 9am anchor never crosses a
UTC boundary — the bug is invisible to CI and only appears on a non-UTC dev
machine, at certain hours.
**Correct approach:** A render-level test whose fixtures are anchored to one
zone must render with a zone the fixtures actually agree with, not the
production default meant for an unauthenticated visitor. The file already had
the right instance of this fix (`LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone`) for its pure-function `lastSeenLabel(...)` assertions; `renderRow()`
was the one caller left on the implicit default.
**Rule:** When a component gains an explicit zone parameter with a
production-meaningful default (here, `'UTC'` for a no-QueryClient caller),
audit every test helper that renders it for what zone its OWN fixtures were
built in, not just what zone the new pure-function tests exercise — a fixture
helper's "any timezone" comment is only as true as the fixtures it never
imagined being read back through an explicit non-ambient zone.
**Enforcement update:** Fixed in the same PR (`renderRow()` now passes
`timeZone={LOCAL_TZ}`, matching `fixtureDaysAgo`'s anchor); negative-controlled
by reverting `daysSince` to ambient-zone math and confirming both this test
and the two DECLUTRMAIL-WEB-2C zone-comparison tests in `data.test.ts` failed,
then restoring and re-confirming green. No hook: this needs a reading of which
zone a fixture was built in, not a pattern match.
