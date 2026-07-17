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

Last run (2026-07-17, this laptop): **26 passed · 0 failed · 3 skipped**. The
3 skips are `env` (Cloud Run), `pubsub`, and `secrets` — all skipped because
`gcloud` is not authenticated locally, **not** because they passed. Someone with
`gcloud auth login` must run those three before launch.

---

## 1. The one thing that blocks launch outright

### Prod Upstash Redis is budget-suspended (as of 2026-07-15)

Only the founder can fix this — it is a billing action, not code.

With Redis suspended, BullMQ enqueue fails, the worker processes zero jobs, no
mailbox ever reaches `readiness = ready`, and the onboarding sync gate spins
forever. **It presents to a user as "I can't log in."** A public launch in this
state means every new signup hits a spinner.

- **Fix:** https://console.upstash.com → `declutrmail-v2-bullmq` → raise the
  budget limit or move to a Fixed plan. Resumes immediately.
- **Verify:** API logs stop emitting `ERR This database has been suspended…`;
  a dev test-login onboarding gate advances to `/senders`.
- **Status: UNVERIFIED as of this session.** There is no health endpoint that
  reports Redis, and `gcloud` was unavailable here, so I could not confirm
  whether it is still suspended. **Confirm before launching.** PR #337's daily
  watchdog now BREACHes on this state, so the next suspension pages instead of
  hiding.

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

1. **Un-suspend prod Redis** and confirm a real login reaches `/senders`. Nothing
   else matters until this is true.
2. Merge **#345** (data-destruction preview), then #344, then #346.
3. Run `./scripts/launch-preflight.sh` from a machine with `gcloud auth login`
   so `env`, `pubsub`, and `secrets` actually execute rather than skip.
4. Decide the §4 gaps — at minimum the failed-initial-sync CTA, which is the last
   dead end on the Settings surface.
5. Either resume the audit tail (§5) or launch knowingly accepting that those
   surfaces are unaudited. **That is a real choice, not a formality** — every
   confirmed bug this session came from exactly that kind of hand-smoking, and
   each one had passed every automated gate.
