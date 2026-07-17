# Public launch readiness — 2026-07-17

**What this is.** The state of play for public launch, written at the end of a
session that smoked the product by hand against the real 7,890-sender mailbox
and fixed what it found. It layers on top of
[`founder-launch-checklist.md`](./founder-launch-checklist.md) (infra, DNS,
secrets — verified 2026-07-09) — **that document is still the contract for
infra**; this one covers product truth and what is left.

**Do not trust this file's infra claims over the script.** Re-derive any infra
state with:

```bash
./scripts/launch-preflight.sh            # all groups
./scripts/launch-preflight.sh dns mail   # dns mail web api env pubsub secrets
```

Last run (2026-07-17, authenticated `gcloud`): **38 passed · 0 failed · 3
warned · 1 skipped**. `env`, `pubsub`, and `secrets` now actually ran (they
were skipped in the earlier unauthenticated run, **not** passed). The 3 warns
are known, documented posture — billing secrets unbound (billing is OFF), and
the shared API/worker service-account + project-wide secret read (FOUNDER-
FOLLOWUPS). The skip is per-secret reader checks, moot under the project-wide
grant. No launch-blocking infra failure remains.

---

## 1. Prod Redis — VERIFIED UP (was flagged as the launch blocker; it is not)

**Status: RESOLVED / not a blocker (verified 2026-07-17, authenticated `gcloud`).**

Earlier this doc led with "prod Upstash Redis is budget-suspended → presents as
'I can't log in'." Both halves were wrong, and I verified it two independent ways:

1. **Redis is up.** The prod `declutrmail-worker` (Cloud Run, us-central1) is
   dequeuing real BullMQ jobs live — `worker.succeeded` every ~60s, including
   `gmail.getClient.kms_decrypt` + a real Gmail fetch for a live mailbox at
   19:16 UTC today. BullMQ dequeues off Redis; if Redis were suspended these
   jobs could not run. Reproduce:
   ```bash
   gcloud logging read 'resource.type=cloud_run_revision AND
     resource.labels.service_name=declutrmail-worker' --limit=20 --freshness=1h \
     --format=json | python3 -c "import sys,json;[print((e.get('jsonPayload') or {}).get('kind')) for e in json.load(sys.stdin)]"
   ```
2. **Login does not depend on Redis anyway.** Auth is stateless JWT-in-cookies
   (`apps/api/src/auth/session-cookies.ts` — access/refresh/CSRF cookies, no
   server-side session store; `csrf.service.ts` touches no Redis/DB). The rate
   limiter **fails open** on a store error (`rate-limit.interceptor.ts` L130-143:
   `catch (err) { /* Fail-open */ return next.handle() }`). So even with Redis
   down, sign-in and all read/write API keep working.

**The real failure mode if Redis ever does go down** is narrower and quieter:
BullMQ workers stall, so a _new_ signup's mailbox never reaches
`readiness = ready` and the onboarding sync gate spins — the app looks alive and
silently does nothing. That is the UI-truth bug class at the infra layer, not a
login outage. PR #337's daily watchdog BREACHes on the suspended-Redis state, so
a future suspension pages instead of hiding.

Full entry: `FOUNDER-FOLLOWUPS.md` → 2026-07-15.

---

## 2. What this session fixed (merged to main)

All five were found by hand-smoking against the real mailbox — **every one
passed CI, typecheck, and all gate agents while broken.** That is the recurring
lesson (CLAUDE.md §8): structural green says nothing about whether the product
tells the truth.

| PR                                                          | What was broken                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#339](https://github.com/CT2689-Tech/DeclutrMail/pull/339) | The senders adapter silently dropped and fabricated wire fields. `Sender` is now `SenderListRow & Derived` built by spread, so wire fields ride through **by construction** — the truth-loss class is gone structurally, not patched.                                |
| [#340](https://github.com/CT2689-Tech/DeclutrMail/pull/340) | Grid/table fact parity; brand-rollup grouped consumer mail providers (your friends' gmail.com addresses collapsed into one "brand"); the sender-detail Gmail link searched `from:@gmail.com` — **every gmail.com sender's mail**, not the one you clicked.           |
| [#341](https://github.com/CT2689-Tech/DeclutrMail/pull/341) | Coverage line ("N senders indexed"); D49 toggle position; the "you replied" chip's checkmark was invisible (white-on-white); a zero reply count rendered `—`, the same glyph the adjacent Read cell uses for _unknown_.                                              |
| [#342](https://github.com/CT2689-Tech/DeclutrMail/pull/342) | **One `K` press kept every row in the triage queue.** Each narrow-layout card mounted its own window keydown listener, and Keep has no preview and no undo (D40). Also: the inline preview had no visible confirm — it confirmed on an undocumented second keypress. |
| [#343](https://github.com/CT2689-Tech/DeclutrMail/pull/343) | **The backend contradicted itself.** List and detail returned the same field names over different windows: the table said a sender's read rate was unknown while her detail page asserted "100% marked read". Both paths now share one rolling-30d definition.       |

## 3. Open PRs — merge order

Each was smoked live before its PR was opened. Merge bottom-up as CI clears.

| PR                                                          | Why it matters                                                                                                                                                                                                                                                                                                                                   | State at handoff |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [#345](https://github.com/CT2689-Tech/DeclutrMail/pull/345) | **Launch-blocking product bug.** "Approve all" previewed 46 suggestions and would have approved **4,961** — measured live — including irreversible one-click unsubscribes. Violates D226 (the preview must describe the mutation that runs). Also fixes the hard-coded "default mailbox" eyebrow and a slider that kept a server-rejected value. | CI running       |
| [#344](https://github.com/CT2689-Tech/DeclutrMail/pull/344) | Settings truth batch (6 findings). Most severe: a mailbox with **unknown** sync health rendered **"Ready"** — unknown claiming success.                                                                                                                                                                                                          | CI running       |
| [#346](https://github.com/CT2689-Tech/DeclutrMail/pull/346) | Removes the dead Weekly-Hero stack (−1,247 lines) per D245. Docs-only additions to FOUNDER-FOLLOWUPS ride along.                                                                                                                                                                                                                                 | CI running       |

**#345 should not wait.** It is the only open item that can destroy user data on
a single click.

---

## 4. Known gaps at launch (accepted or needing a decision)

| Gap                                                                                                                                                                                                                                                         | Call needed                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Failed INITIAL sync has no retry CTA.** The only sync route 409s `SYNC_NOT_READY` in exactly that state, so an honest retry needs a new BE endpoint. Deliberately **not stubbed** (§10). The worker auto-retries, so it is a missing CTA, not stuck data. | Founder: add `POST /api/v1/sync/initial/retry`, or make the card say a retry is already scheduled so the state stops reading as terminal. |
| **Two `useBillingSubscription` hooks** with different query keys and retry policies — Settings and `/billing` can disagree about billing state. Not observed live.                                                                                          | Consolidate onto one owner.                                                                                                               |
| **`review-session.tsx` is unreachable.** Its only entry point was the Weekly-Hero CTA (removed in #346). Kept because the bulk-review surface is still planned.                                                                                             | Founder: keep or delete.                                                                                                                  |
| **6 render-body `Date.now()` sites** — hydration-warning risk, cosmetic only.                                                                                                                                                                               | Explicitly not launch-blocking; post-launch chore.                                                                                        |
| **D49's rationale is stale** — it describes the pre-D245 card with a verdict badge. The _decision_ (grid default) stands; only the reasoning drifted.                                                                                                       | Plan patch, so a future agent doesn't "restore" verdict badges to match the text.                                                         |

---

## 5. Not done in this session — the honest list

- **The audit verification tail (~40 findings) was never re-run.** Brief,
  screener, billing-deletion, onboarding-sync and parts of settings/autopilot
  were surfaced by the audit workflow but **never adversarially verified**. They
  are neither confirmed nor dismissed. Resume with
  `Workflow({scriptPath: '…/prelaunch-ux-bug-audit-wf_faad54b7-610.js', resumeFromRunId: 'wf_faad54b7-610'})`.
  **Treat "no known bugs" in those areas as "not looked at yet."**
- **Surfaces smoked this session:** senders (list, table, detail, search,
  filters, rollup), triage (narrow keyboard, both preview paths), settings
  (mailboxes, action prefs, standing policies), autopilot (approve-all preview,
  eyebrow). **Not smoked:** brief, screener, activity, onboarding, billing,
  account deletion.
- **`readiness === null` was not live-smoked** — forcing it means deleting a
  `provider_sync_state` row on the real mailbox, which risks triggering a
  re-sync. Covered by unit test + code review only.
- **No E2E (Playwright) run** this session.

---

## 6. Pre-launch sequence

1. ~~Un-suspend prod Redis~~ — **done: verified UP (§1), not a blocker.**
2. ~~Merge #345 → #344 → #346~~ — **done: all eight fix PRs (#339–#346) plus the
   D-trailer flag (#348) are merged.** No open PRs remain.
3. ~~Run preflight with `gcloud auth login`~~ — **done: 38 passed · 0 failed · 3
   warned · 1 skipped** (2026-07-17). The 3 warns are known posture, not
   failures (see §1). Re-run before the actual launch to catch drift.
4. Decide the §4 gaps — at minimum the failed-initial-sync CTA, which is the last
   dead end on the Settings surface.
5. Either resume the audit tail (§5) or launch knowingly accepting that those
   surfaces are unaudited. **That is a real choice, not a formality** — every
   confirmed bug this session came from exactly that kind of hand-smoking, and
   each one had passed every automated gate.
