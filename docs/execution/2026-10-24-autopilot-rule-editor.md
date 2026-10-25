# Existing Autopilot rule customization

Owner and integration owner: this task. Isolated worktree based on main
`86d40fdb8490aa110a8eb89d4f9f5aa5f6eee705`; no dependency on another open PR.
Owns the Autopilot preset editor, shared configuration/approval contracts, matcher,
API save/preview and apply-worker currency checks. Billing, onboarding, provider
permissions and database schema are excluded.

## Flow contract and repair

Before: Edit rule exposed evaluation details, with only two presets offering a
confidence slider. The two dormancy presets had no editable conditions or action.
After: Edit rule opens the existing rule's name, condition values and supported
Archive, Later or Unsubscribe action. Save persists the same rule identity;
preview and matching interpret the same validated metadata configuration.

Saving returns Active to Watch first, preserving Paused and disabled states.
Pending suggestions are superseded and recomputed. Approved/unapplied work blocks
material edits until its original action finishes. Material saves and lifecycle
transitions increment a revision. Concurrent edits, stale cutoff approvals and
stale enable/activation/resume confirmations fail with registered recovery codes.
The rule and match locks serialize saving with approval; apply discards matches
and summary updates computed from an older revision. No network calls occur in
these transactions. Unsubscribe retains the stricter daily cap regardless of its
original preset and never promises Undo. Preset condition families/recommendations
remain fixed so customization cannot bypass existing approval-only guards.

| State / transition           | UI and cache result                                                           | Verification                     |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| Open / cancel                | Persisted values / discard draft, return focus                                | Unit, built-in browser           |
| Invalid / failed save        | Validation or recoverable error; draft retained                               | Unit, API/filter                 |
| Concurrent edit              | Refresh-needed conflict; no stale overwrite                                   | API, editor unit                 |
| Save enabled rule            | Saved configuration; Active returns to Watch first; rules/pending invalidated | API, browser                     |
| Save paused/off              | Saved configuration; remains stopped                                          | API matrix                       |
| Approved work outstanding    | No edit committed; review/finish existing batch                               | API rollback assertion           |
| Stale approval/start preview | No changed action approved/started                                            | API, web contract tests          |
| Old apply sweep              | No stale matches or summary                                                   | Worker mid-sweep edit regression |
| Cached read failure          | Fields and Save disabled, Cancel usable; Retry recovers                       | Web regression, story            |
| Account change               | Existing mailbox-scoped library/editor reset retained                         | Existing scoped tests            |
| Preview / Schedule / Undo    | Existing action-specific lifecycle retained                                   | Worker suite; browser preview    |

Existing authentication, Protected exclusions, quota, pause, entitlement, offline
and unknown-result behavior continues through the existing action pipeline.
No new Gmail fields, content collection, database migration or telemetry payloads.

## Verification and boundaries

- 216 Autopilot web tests; 119 API/controller/service tests plus 17 exception-filter
  tests; 61 matcher/apply tests; 69 action-worker tests; 949 shared tests, including contract, glossary and literal
  guards, passed. All 22 browser harness tests passed, including the missing-editor-journey negative control. Worker tests include Schedule deferral and action recovery.
- Negative control: restoring the fixed preset matcher made the new configured
  rule integration assertion fail; restoring configurable matching passes.
- Workspace typecheck, lint (six existing warnings, no errors), formatting,
  production web build, 49-route bundle budget and prerender checks passed.
- Built-in browser, isolated synthetic mailbox and production Next build: changed
  Newsletter graveyard's name, dormancy/read-rate values and action to Archive;
  saved, reloaded, reopened and verified persistence and the real API preview.
  At 320px the document width remained 320px. Keyboard Save returned focus to Edit.
  Real mailbox mutations, production settings edits and real Unsubscribe were not
  used for testing. Synthetic metadata/settings remain in the task-owned database.
- Added a real API browser journey for existing preset save/reload/focus and updated
  the 320/375/1280px light/dark component journey. CI execution is a separate gate;
  local browser verification used Codex's built-in browser only.
- Independent reviewer: architecture, design-system and flow passes; independently
  ran 112 API/filter, 90 web and 61 worker tests. No blocking findings remain.
- Production authentication was resumed through the existing Google session;
  intended account identity was visible. The changed editor still requires normal
  merge, deploy and read-only production verification before being called live.

## Integration and rollback

No migration or external dependency. The existing release deploys the worker
before the API, which ensures saved conditions are understood before writes are
accepted. Optional read fields and guarded starts protect a staggered web/API
rollout. An old worker ignores configured preset conditions: retain this worker
support when rolling back web/API, or stop configured rules before rolling back
the worker. JSON schema compatibility alone does not make that rollback safe.

Local candidate is ready; PR/queue/release status and exact serving evidence will
be recorded in the PR. No production rule, Schedule or mailbox changes by this
work. General-purpose condition families and preset Delete execution are outside
this bounded enhancement; existing sender-list Delete remains available.
