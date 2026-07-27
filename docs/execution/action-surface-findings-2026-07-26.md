# Action-surface findings — 2026-07-26

**Source:** three parallel read-only investigations, run after the founder observed
three defects by hand while dogfooding: Delete missing on some surfaces, action counts
changing between display and click, and "only Keep active" on some senders.

**Status:** investigated and verified. **No code changed.** Every CONFIRMED finding
below was re-verified against primary sources by the main session, not accepted from
the investigating agent.

**Relationship to A3:** independent. None of this is caused by, or blocked on, the
free-tier work in `a3-pricing-rework-plan.md`. Findings 1 and 2 are more urgent than A3.

---

## 1. CRITICAL — single-sender Archive silently discards the time window

**Confirmed. Mutates mail the user explicitly excluded.**

`archiveRequestSchema` (`apps/api/src/actions/actions.types.ts:37-43`) is `.strict()`
and carries only `selector` and `override`. **There is no `olderThanDays` field on the
wire.** The frontend drops it at the call site — `apps/web/src/features/senders/senders-screen.tsx:684-690`:

```ts
if (verb === 'Archive' && senders.length === 1 && opts?.secondary == null) {
  const mutationArgs: { senderId: string; override?: boolean } = { senderId: sender.id };
  enqueue.mutate(mutationArgs, …)
```

The local type itself excludes the window. Meanwhile the multi-sender branch
(`senders-screen.tsx:1070-1082`) passes `olderThanDays: opts?.olderThanDays ?? null`
correctly, and the worker (`packages/workers/src/label-action.worker.ts:614-638`)
implements the window properly — its comment even states _"the resolved set matches
what the FE chip row showed."_ The worker is right. The DTO strips the window before
it can arrive.

**Repro** — a sender with 250 INBOX messages, 12 of them older than a year:

1. Senders or Sender Detail → that sender → **Archive** (exactly one sender selected).
2. Chip row renders real per-bucket counts: `All inbox 250 · 30 days+ 41 · 1 year+ 12`.
   Pick **1 year+**.
3. Headline: "**12** emails currently match (older than 365 days) for Archive." Confirm.
4. **250 are archived.**

Why it looks intermittent: the same window works correctly when two or more senders are
selected, and works for Delete and Later (both take the composite path). Only
single-sender Archive is broken.

**Root cause — two enqueue wires for one verb.** The legacy window-less
`POST /api/actions/archive` still exists beside the composite `POST /api/actions`, and
the FE prefers the legacy one for this case. Per CLAUDE.md §2.6 (prelaunch — no
hypothetical compatibility) there is no user to preserve it for. **Deleting the legacy
route and always using `enqueueComposite` closes this by construction** — a stronger
fix than adding the field, because it removes the second wire that can drift again.

## 2. CRITICAL — Later + "also act on past emails" executes zero

**Confirmed. The confirmed action silently never happens.**

`apps/api/src/actions/actions.service.ts:684-686` enqueues the primary and secondary
rows with `Promise.allSettled` — **in parallel, on one queue, with no dependency**:

```ts
const enqueueResults = await Promise.allSettled(
  freshRows.map((row) => this.enqueueJob(row.actionId, mailboxAccountId, row.idempotencyKey)),
);
```

`label-action.worker.ts:620` resolves the target set at **run time** via
`'INBOX' = ANY(label_ids)`. Later's forward change is
`removeLabelIds: ['INBOX'], addLabelIds: ['DeclutrMail/Later']`. So whichever job runs
first strips `INBOX`, and the second resolves **0 ids** → `affected_count = 0`, no undo
token, and an activity row reading "delete · 0 emails".

`docs/adr/0020-unified-actions-endpoint-composite.md:128` specifies a
`waitForCompositeId` DAG dependency. **It was never implemented.** And for a Later
primary the pairing is self-cancelling even with correct ordering — Later's whole
purpose is to remove `INBOX`, which is the predicate the secondary needs.

**Repro** — sender with 30 INBOX messages:

1. Senders → sender → **Later** → secondary **"Delete them"** → **All inbox** (chip: 30).
2. Modal: "…Also: move 30 emails to Trash." Confirm.
3. The FE polls only `res.actionId` (the primary), so the receipt reads "Moved 30 to
   Later" and the deletion is never reported as having failed.

Verify without the UI:

```sql
select verb, requested_count, affected_count, composite_id
from action_jobs order by created_at desc limit 2;
```

The secondary row shows `requested_count = 30, affected_count = 0`.

**Fix is a decision, not a patch.** Either implement the ADR-0020 dependency _and_
re-resolve the secondary against the post-primary label set, or remove the
Later+secondary combination from the modal. Archive+secondary has the same ordering
gap but is not self-cancelling.

## 3. Delete is missing from three surfaces — two accidental

**Accidental, and the product's own copy points at one of them:**

- **Sender Detail toolbar** — `apps/web/src/features/senders/detail/action-toolbar.tsx:27-32`
  hardcodes a 4-tuple. Its docstring still encodes the pre-ADR-0019 rule. Because this
  toolbar is the only producer of an action request on that page, the entire Delete
  path below it is unreachable dead code.
- **`SenderRowDetail` "Decide" row** — `apps/web/src/features/senders/table/sender-row-detail.tsx:248-278`,
  four literal `<Button>`s. Backs **three** surfaces: the table expand-row
  (`sender-table.tsx:821`), the list-row expand (`sender-list-row.tsx:259`), and
  `SenderPeek` (`sender-peek.tsx:171`) — the only rich per-sender panel reachable on a phone.

`apps/web/src/features/triage/why-no-delete.tsx` renders under **every triage queue**
and tells users: _"deleting a sender's mail lives on Senders **and Sender Detail**."_
Sender Detail has no Delete button.

**Deliberate and sound, leave alone:** Triage (closed 4-verb union, documented,
founder-ratified, and backed server-side — `triage_verdict` has no `delete`) and
Autopilot rules (`autopilot_action_kind` has no `delete`; an auto-firing Delete would
run without the mandatory D226 preview — changing that is a CLAUDE.md §9 stop-condition).

**Server side is fully wired.** `action_verb` includes `delete`; `/api/actions` accepts
it as primary and secondary; the worker allowlists it; tier gating is identical to
Archive. The gap is purely three hand-rolled frontend arrays.

**Plan-drift ruling (founder, 2026-07-26).** D40's 2026-05-18 patch enumerates the
Sender Detail toolbar as K/A/U/L. CLAUDE.md §2.2 declares five canonical verbs via
ADR-0019 and §3 puts CLAUDE.md §2 above D-decisions. **Ruled: Delete belongs on Sender
Detail; D40's patch is stale.** Triage stays as it is.

**Why every gate missed all of this:** no test on any surface pins a verb count, and
`check-microcopy.sh`'s `canonical-verbs` rule only bans the word "Screen". ADR-0019
mandates that every verb surface read `VERB_REGISTRY`; nothing enforces it.

## 4. Protected senders collapse to Keep-only — and the fix is already built

**Root cause is one boolean.** `sender_policies.is_protected` feeds
`isStandingProtected()` (`apps/web/src/features/senders/data.ts:145`), which is the
_sole_ term in `canArchive`, `canLater`, `canDelete` and the first term of
`canUnsubscribe`. All four go false together; `keep: true` is hardcoded at
`action-row.tsx:98`. Triage reaches the same state via `row.protectionReason !== null`
(`triage/data.ts:457-473`).

**These flags are set automatically.** `packages/workers/src/automatic-protection.ts`
protects on ≥3 replies, a starred message in the past year, or ≥3 Gmail-important
messages — exactly the signals CLAUDE.md §2.6 D245 permits. Consequence: **every sender
the user actually corresponds with becomes read-only across the whole product.**

**The server was built for the desired behaviour and shipped dark:**

- `actions.service.ts:200,568` return 409 `PROTECTED_SENDER` with copy written as a
  _confirm_, not a refusal: **"This sender is Protected. Confirm to archive anyway."**
- An `override` param is threaded end-to-end — wire contract → controller → service →
  API client — with the docstring _"`override` is required to act on a Protected sender."_
- **`override: true` appears in exactly two test files and nowhere else.** No component,
  hook, or modal ever passes it. The confirm affordance was never rendered, and because
  the client greys the buttons first, the 409 that would prompt for it is unreachable.

**The client contradicts the server's own written contract:**

> `apps/api/src/triage/triage.read-service.ts:313-316` — _"Display-layer only: the
> engine's verdict stays in `triage_decisions` untouched, **every K/A/U/L action remains
> available on the row**, and the override is annotated in the reasoning so the user sees why."_
>
> `apps/web/src/features/triage/data.ts:454-455` — _"Mirrors the senders feature:
> **protected rows can only be Kept**."_

**The "(D29 spec)" citation does not hold.** `triage/action-toolbar.tsx:37-39` justifies
the inert buttons by citing D29. D29 (`Implementation-Plan.md:1292`) says: _"Each row
gets **all four buttons** with single-letter keyboard shortcuts."_ Its only patch
reverbs S→L. D29 mandates the constant shape, not the disabling — so this is a
mis-citation, not plan-drift.

**D245 says "excluded from bulk and automatic mail-changing actions."** The bulk and
worker gates cite it accurately. The single-sender gates cite **D42** and justify
themselves as "defense-in-depth", not as any user-intent rule.

**Two asymmetries:**

- **Triage's protected gate is client-only** — the server has no protected check on the
  triage act path, so a `curl` succeeds today. The block is theatre.
- **Screener is the inverse** — buttons render live, the server 409s, and
  `screener-screen.tsx:308` toasts _"unprotect it first"_: a dead end with no confirm path.
- `canUnsubscribe` also greys on `gmailCategory !== 'primary'` (`senders/data.ts:152`)
  with **no server counterpart and no reason text** — a silently disabled button
  enforcing a rule that exists nowhere else in the system.

**Fix:** drop the client-side protected blocks on explicit single-sender actions; keep
`actions.service.ts:200,568` exactly as they are (409-unless-override is the right
posture); pass `override` from the D226 confirm modal that is already mandatory. That
is a line of copy, not a new surface. **Leave every bulk and worker gate untouched** —
those are what D245 actually mandates.

---

## 5. Other count divergences — confirmed, no wrong mutation

Ordered by user impact. None of these move the wrong mail; they display numbers that
contradict what happens.

| #    | Surface                                             | Divergence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | Autopilot Observe banner, beside "Switch to Active" | `autopilot.read-service.ts:382` — `filter (where matched_at >= now-7d)` constrains which _match rows_ contribute, never which _messages_; the join at `:385-392` has no date predicate on `mail_messages`. So "would have archived N in the last 7 days" counts every current-inbox message of any age from any recently-matched sender. Dismissed matches also contribute (no `resolution` filter), and the stale-evidence guard is applied to `pendingTotal` (`:380`) but not to `senders7d`/`messages7d`                                                                           |
| 5.2  | Screener heading + `screener_shown` analytics       | `screener-screen.tsx:392` falls back to `state.rows.length` when the count query is in flight or errored (`retry:false`) — that is the server page size of 50 (`screener.controller.ts:49`). A 3,000-sender backlog renders "50 new senders waiting", and fires `pending_count: 50` to analytics                                                                                                                                                                                                                                                                                      |
| 5.3  | Any confirm modal reopened within 5 min             | `use-action.ts:176` `useCompositePreview` sets `staleTime: 0` but inherits the default 5-minute `gcTime` (`lib/query-client.ts:33` sets only `staleTime`). A cache hit makes `livePreviewReady` true (`confirm-action-modal.tsx:266-272`), so confirm is **enabled on stale data** — ⌘⏎ before the refetch lands executes against the live set                                                                                                                                                                                                                                        |
| 5.4  | Triage domain-batch card                            | `domain-batch.ts:76-96` groups ≥3 consecutive rows **without** filtering protection, while `domain-batch-card.tsx:48` counts only unprotected. With ≥2 protected in the run the card offers "1 senders … decide together?", `useBulkActionPreview` is disabled at length 1 (`use-action.ts:222`), and the sheet sits at "Counting the inbox…" with confirm permanently disabled                                                                                                                                                                                                       |
| 5.5  | Single vs bulk preview of the same sender           | `previewComposite` (`actions.service.ts:413`) is the **only** count in the entire action pipeline that filters `is_outbound = false`. Enqueue counting, the bulk preview, and the worker all omit it. Self-sent / self-CC mail (both `SENT` and `INBOX`) is under-counted in the single preview and over-executed. `confirm-action-modal.tsx:288-290` also gates "nothing to act on" off the unfiltered `archivePreview.inboxCount` while the headline renders the filtered `compositeCount` — so the modal can read "0 emails currently match" **with confirm enabled**, then move 1 |
| 5.6  | Post-action receipt "X of Y changed"                | `requestedCount` is stamped at enqueue (`actions.service.ts:574-578`); `affectedCount` comes from `ids.length` at execution (`label-action.worker.ts:398`). Any inbox change in between (Autopilot sweep, incremental sync, Gmail) turns a clean success into "3 of 47 emails changed"                                                                                                                                                                                                                                                                                                |
| 5.7  | Bulk batch receipt denominator                      | `getBatchStatus` (`actions.service.ts:1035-1036`) sums **all** sibling rows; `enqueueBulkComposite` (`:962`) returns primaries only. Bulk Later + secondary yields a permanent `'partial'` receipt reading "N of 2N emails changed"                                                                                                                                                                                                                                                                                                                                                   |
| 5.8  | Autopilot "Switch to Active" modal                  | `activate-rule-modal.tsx:181-194` states M **messages** actionable now, uncapped, on the line above a `dailyActionCap` expressed in **actions** (100/50/25). No "already queued" dedup                                                                                                                                                                                                                                                                                                                                                                                                |
| 5.9  | Autopilot rule card "Last run · N matched"          | `autopilot-apply.worker.ts:434-443` writes `lastRunActions: matchesForRule.length` (candidates); the actual insert is `onConflictDoNothing` and the honest counter is `inserted.length` (`:420`). A re-sweep where candidates already have pending rows writes 0 and reports the full candidate count                                                                                                                                                                                                                                                                                 |
| 5.10 | Autopilot per-group "N waiting" above "Approve all" | `suggestion-group.tsx:76-78` renders a page-capped count (50, `contracts/autopilot.ts:34`) with **no `+` suffix**, directly above an uncapped `approveAllForRule`. The screen header adds `+`; the group header does not. `pendingTotal` — the uncapped truth — is on the same DTO, unused here                                                                                                                                                                                                                                                                                       |
| 5.11 | Screener row "Messages so far: N"                   | `screener.read-service.ts:105` reads `senders.total_received` — lifetime, all labels — while the same card's preview shows INBOX-only. "Messages so far: 40" beside "2 emails currently match in Inbox"                                                                                                                                                                                                                                                                                                                                                                               |
| 5.12 | Screener decide on a Protected sender               | `decide-preview.tsx:195` shows `counts.all` which does not exclude protection; `screener.service.ts:130` sends `override: false` → 409. Preview promises N, execution moves 0 and errors                                                                                                                                                                                                                                                                                                                                                                                              |
| 5.13 | Selection bar verb buttons                          | `selection-bar.tsx:182` counts **senders**; the modal headline (`confirm-action-modal.tsx:929`) counts **emails**. "Archive 12" → "3 emails currently match"                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5.14 | Sender row / card headlines                         | `monthlyVolume` (30d, all labels) and `totalReceived` (lifetime, all labels) sit next to action buttons whose modal counts INBOX-now. By design, reads as a bug                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5.15 | `monthlyVolume ?? 0`                                | `sender-row-detail.tsx:142`, `sender-list-row.tsx:54`, `confirm-action-modal.tsx:530` coalesce a nullable wire type to a factual `0` next to action buttons. BE currently always fills it, so latent — PLAUSIBLE, not confirmed                                                                                                                                                                                                                                                                                                                                                       |

---

## Systemic causes worth fixing once

1. **Two enqueue wires for one verb.** The legacy `POST /api/actions/archive` exists
   beside the composite endpoint and cannot express a window. Deleting it closes
   finding 1 by construction and removes the class.
2. **No execution ordering for composite secondaries.** ADR-0020:128 specified it; the
   code enqueues in parallel. Finding 2.
3. **Hand-rolled verb arrays.** Three surfaces bypass `VERB_REGISTRY` despite ADR-0019
   requiring it, with no test or hook enforcing it. Finding 3.
4. **Client-side gates with no server counterpart, and server gates with no client
   affordance.** Finding 4, both directions.
5. **Counts sourced from a different query than the action they label.** Findings 1,
   5.1–5.14. The recurring shape is a count filtered one way (window, `is_outbound`,
   protection, page cap, label set, time basis) displayed next to an action resolved
   another way.

## Suggested sequencing

Independent of A3, and ordered by harm:

| PR     | Scope                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Finding 1 — delete the legacy archive route, single-sender Archive rides `enqueueComposite`. Smoke: pick a window, confirm the executed count equals the chip |
| **C2** | Finding 2 — decide ordering-vs-removal for composite secondaries, then implement                                                                              |
| **C3** | Finding 4 — protected becomes confirm-not-block on explicit single-sender actions; wire `override` from the D226 modal; bulk and worker gates untouched       |
| **C4** | Finding 3 — replace the two hand-rolled arrays with `SenderActionRow`; add a test that pins verb coverage per surface so this cannot drift again              |
| **C5** | Findings 5.1–5.4 — the counts that sit next to a destructive button                                                                                           |

## Not verified

- Findings 5.5–5.15 are confirmed **in code** by the investigating agent but were not
  independently re-verified by the main session, and no live repro was run for any of them.
- Findings 1, 2, 3 and 4 were re-verified against primary sources by the main session.
  **None was reproduced against a running app** — all evidence is static.
