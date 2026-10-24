# Complimentary Pro: Backlog Pass hierarchy

## Flow contract and ownership

A person opening Plan & billing should first understand their existing access.
For confirmed complimentary Pro, the additional Backlog Pass purchase should remain
findable without taking priority over the Free/Plus/Pro comparison. Keep anchored
sections, bottom Account navigation and the existing purchase preview.

Root owns codex/comped-pro-pass-hierarchy in isolated worktree 58a9, based on fresh main
726ac77. Owned scope: Billing projection presentation, PlanPicker/Pass variant,
affected tests and existing stories. No overlapping open PR or unmerged dependency.
One integration owner, independent reviewer with no implementation authorship.

Before: a full-width filled Pass card precedes all plan cards for complimentary
Pro, even though those tools are already included. After: only confirmed current
complimentary Pro has a compact optional-purchase row below the plan cards, with
localized price/duration/account/no-renewal facts and the existing secondary action.
No extra disclosure click. Selection still highlights the row and opens the same
Before you pay preview; Not now dismisses it. Explicit Pass links still open that
preview. Browser smoke exposed an existing hidden Plus selection beneath the Pass
deep-link preview: dismissing Pass revealed a recurring Plus preview. The offer
now owns its deep link exclusively, so Not now returns to the comparison. Pending,
nonbacking and provider/geo gates remain authoritative.

Other paid/included/complimentary Plus/Pass-only/Free states retain their existing
layout. Expiry is not reinterpreted. No policy, catalog, SDK, API, schema, payment,
consent or Gmail behavior changes. No live payment/provider/Gmail mutation/deletion.
Use synthetic fixtures for paid, expiring, overlap and failure states.

## Verification

The hierarchy assertion failed against the original PlanPicker. The deep-link
dismissal assertion separately failed before its repair. Focused Billing tests,
workspace typecheck/lint/format, Storybook, production build and bundle/prerender
budgets passed on the hierarchy candidate. Initial parallel builds caused two
one-second lazy-import test timeouts; the isolated single-worker Billing run passed
all 426 tests. Typecheck was repeated after generation and negative-control source
restoration; the restored candidate passed. No threshold or timeout was changed.

Isolated production-build smoke uses disposable loopback Postgres/Redis and a
synthetic complimentary Pro workspace, no worker or provider credentials. Desktop
and 320px dark/light render the compact row below the plans with no horizontal
overflow, a 44px phone target, visible keyboard focus, selected outline and clear
one-time purchase facts. Selecting and dismissing the ordinary preview worked;
explicit deep-link dismissal uncovered the adjacent defect above. Console logs
were empty. Source reviewer found no structural/copy/React/flow blocker.

Final repaired candidate passed all 426 Billing tests, a fresh production build,
all 49 bundle caps, 32 static-route assertions, workspace types, lint and formatting.
Rebuilt browser smoke verified explicit Pass preview dismissal leaves zero checkout
panels. A dated complimentary grant retained the compact offer and truthful expiry
note. A paused paid Plus row beneath complimentary Pro kept the Pass disabled,
displayed its nonbacking notice and opened no preview. The independent source and
desktop/phone visual review found no blockers; provisional Billing score 93/100,
up from 91 (expert judgment, not measured usability). Both task-specific grant and
subscription row counts were zero after restoration; disposable services stopped.
No production state was mutated.

Pending: protected PR/queue/main checks; exact serving deployment identity, live
UI/health and final Billing score. Keep ready, queued, merged, deployed and
production-verified evidence separate. No broader billing policy or provider
opportunities are added by this bounded presentation fix.
