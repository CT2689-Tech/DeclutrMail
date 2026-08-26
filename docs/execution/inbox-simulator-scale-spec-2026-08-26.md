# Inbox Simulator — sell scale, and stop the demo drifting

**Date:** 2026-08-26
**Closes:** D133
**Touches:** D226 (mandatory preview), D227 (canonical verbs), D245 (Protected), D251 + `[PACKAGING PATCH 2026-08-23]`
**Status:** approved design, not yet planned

---

## 1. Why

`/inbox-simulator` is honest and current. It is not broken. It under-sells, and it
drifts in a predictable way.

**Message-match failure.** The hero promises _"Clear thousands of emails by sender"_
and _"Turn on a rule and it keeps doing it."_ The demo delivers three safety lessons,
one sender at a time, and proves neither promise. A visitor arriving from that hero
experiences a downgrade at the exact moment they chose to engage.

**Emotional sequencing failure.** `.agents/product-marketing.md` names the buyer's
tension as _"Relief versus regret"_, and its proxy customer language carries both
halves as adjacent quotes from one Reddit thread:

> "I don't want to have to manually archive 700 pages."
> "without accidentally deleting anything important"

The buyer holds both **simultaneously**. The current demo resolves them
**sequentially**, asking a skeptic to carry the anxiety for three steps before seeing
any payoff.

**Traffic-source failure.** Use case #1 in the positioning doc is _"Storage warning or
a backlog in the thousands."_ `/how-to/gmail-storage-full` is live and says in its own
words that _"archiving frees nothing"_ and that tidiness advice _"recovers no space at
all."_ The demo never demonstrates Delete.

---

## 2. The drift law

Every drift item found in the 2026-08-26 audit obeys one rule:

> **What the demo imports stays current. What the demo retypes rots.**

| Retyped → rotted                                                           | Imported → stayed correct                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Plan strip tier strings → Screener silently went missing                   | Verb set — Delete appeared by itself when D227 added it                |
| Hand-rolled `DemoPreviewDialog` → the historic-archive toggle went missing | Tier numbers — "50 cleanup actions" from `TIER_MANIFEST`               |
| Bottom CTA label → drifted from the `Review my Gmail senders` standard     | Safety copy — `ACTION_SAFETY_SUMMARY`, `OAUTH_SCOPE_DISCLOSURE`        |
| Fixture verdicts hardcoded, never engine output                            | Row chrome — `TriageRow`, `ActionToolbar`, `ActionPreviewPresentation` |

Not one imported thing rotted. Not one retyped thing survived.

**Therefore this spec has two jobs, and the second is the durable one:** change what the
demo shows, and convert retyped things into imported things so the next packaging or
engine change flows in without anyone remembering to look.

---

## 3. The arc

Four guided steps. Each ends where the next begins.

### Step 1 · Scale

A mixed **`amazon.com` domain batch**: six adjacent fixture senders, deliberately
carrying _different_ engine recommendations, one of them Protected.

```
┌─ 6 senders from amazon.com — decide together? ──────────────┐
│   Amazon.com                    1,204 msgs   [ Archive ]    │
│   Amazon Prime Video              312 msgs   [ Archive ]    │
│   Amazon Advertising              488 msgs   [ Unsubscribe ]│
│   Amazon Orders                   661 msgs   [ Later ]      │
│   Amazon Photos                   107 msgs   [ Archive ]    │
│   Amazon Account Security          14 msgs    PROTECTED     │
│   [ Archive all 5 ]  [ Later all 5 ]  [ Decide one by one ] │
└─────────────────────────────────────────────────────────────┘
```

Three things happen here that never happen in today's demo:

1. **Scale** — 2,772 messages reachable in one decision, against 156 for one sender.
2. **The engine visibly disagrees with itself** — Archive, Unsubscribe and Later pills
   side by side, and the visitor overrules all of them with one verb. The sender-first
   thesis made physical rather than narrated.
3. **Protection is shown, not claimed** — the button reads `Archive all 5`, not 6. The
   security sender sits in the card being skipped.

Confirm opens the real `BatchActionSheet` with exact per-sender totals. Nothing moves
until confirm.

The per-sender counts above are **illustrative targets**, not final fixture values, and
they are synthetic inbox counts (`syntheticInboxCount`) rather than all-time totals. The
2,772 headline is their sum across the five eligible senders; the Protected sender's 14 is
excluded because the action skips it.

**Honest constraint, inherited from the product, not invented for the demo:** `BatchVerb`
is `'Archive' | 'Later'` only. Keep is a per-sender policy intent; Unsubscribe depends on
each sender's channel (D9/D230). So the Unsubscribe-recommended row is archived with the
rest, or the visitor drops to one-by-one. This sets up step 2.

### Step 2 · Irreversible

LinkedIn · Unsubscribe. Unchanged in intent, but rendered by the **real `ActionSheet`**
instead of the bespoke demo dialog — which means the historic-archive toggle finally
appears:

> ☐ **Also archive the 192 emails already in the inbox**
> _Uses a second cleanup action on Free._

Off by default, matching the product: it is a separate Gmail mutation and a second
cleanup unit on Free, so it must be an explicit opt-in.

The figure in that label is the **live inbox count** (192 for the LinkedIn fixture via
`syntheticInboxCount`), never the 2,432 all-time total. D226 is explicit that the toggle
carries the live count and "never a lifetime estimate"; the all-time figure belongs on the
row, not in the preview.

This step survives every rearrangement because Unsubscribe is the only thing in the
product that genuinely **cannot** be undone. Cutting it would leave the demo overselling.

### Step 3 · Make it stick

Autopilot rule activation, via `ActivateRuleModal` + `RulePreviewPanel`.

```
┌─ Turn on: Archive promotional senders ──────────────┐
│  If this rule were active now, it would affect:     │
│    Amazon Advertising · Groupon · Old Navy · +4     │
│  Protected senders are never matched.               │
│  [ Turn it on ]        [ Watch first, don't act ]   │
└─────────────────────────────────────────────────────┘
```

Proves the hero's second promise, which is currently proven nowhere, and answers the
objection the positioning doc names outright: _"Why keep paying after the backlog is
gone?"_

`Watch first, don't act` is Observe mode — a real product mode. This ends the demo on
capability rather than limitation without costing any honesty.

**Label it Plus.** Autopilot and Quiet moved Pro → Plus on 2026-08-23.

### Step 4 · Free the space

```
You archived 2,772 messages.
Every one still counts against your Gmail quota.

Archive moves mail out of Inbox. It does not remove it from your account.

Amazon.com · 1,204 messages
[ Keep ][ Archive ][ Unsubscribe ][ Later ][ Delete ]
```

Serves use case #1 and matches what `/how-to/gmail-storage-full` already says. Copy
comes from `DELETE_RECOVERY_CLAIM` and `MANUAL_ACTION_SCOPE_CLAIM`, both of which already
separate Activity undo from Gmail Trash recovery — two different mechanisms that happen
to share the number 30.

**No byte figures.** `TriageDecisionRow` carries no size field. `mail_messages.size_bytes`
exists and Sender Detail renders real KB/MB from it, but there is no per-sender aggregate
anywhere in the product. A megabyte number on a Triage row would invent a capability. The
point lands in messages.

### Completion

- Backlog cleared, as a count of messages across confirmed decisions.
- **Measured** elapsed time from first decision to completion. Never hardcoded.
- `CASA_VERIFICATION_APPROVED_ON` next to the connect CTA as an earned trust signal.

**D133's projection wording is rejected.** It specifies _"~4,200 future emails will skip
your inbox."_ The demo performs manual actions, and the public FAQ answers _"Does
archiving a sender automatically archive future messages?"_ with _"No. Manual Archive acts
on the current matching inbox messages."_ Shipping D133 verbatim would put a claim on the
demo that the FAQ refutes two clicks away. Project **backlog cleared**, never future mail.

---

## 4. Component reuse

| Step | Reuses                                                       | Auth/query clean?                          |
| ---- | ------------------------------------------------------------ | ------------------------------------------ |
| 1    | `DomainBatchCard`, `BatchActionSheet`, `findDomainBatches`   | ✗ — via `MailboxActionContext`, see §6     |
| 2    | `ActionSheet`, `ActionPreview`                               | ✓ — pulls only `ContextualHelp` → glossary |
| 3    | `ActivateRuleModal`, `RulePreviewPanel`, `ConfirmModalFrame` | ✗ — via `MailboxActionContext`, see §6     |
| 4    | `TriageRow`, `ActionToolbar`, `ActionPreviewPresentation`    | ✓                                          |

**`DemoPreviewDialog` is deleted.** It is a hand-rolled copy of `ActionSheet`, and it is
why the historic toggle went missing. Deleting it removes the drift source, not just the
current symptom.

---

## 5. Class fixes — the anti-drift work

### 5.1 Verdicts run the real engine

Fixtures stop hardcoding `verdict: 'archive'`. They carry `SenderSignals` and derive the
verdict through **`runCascade`**.

`runCascade` (`packages/workers/src/score-cascade.ts`) is already a pure function — no DB,
no LLM, no clock — with a single type-only import from `@declutrmail/db`. Move it to
`packages/shared` so both the worker and the browser can call it.

Effect: the demo can never display a recommendation the engine would not make, and an
engine change updates the demo with no human step. This is D133's actual demand.

### 5.2 The plan strip derives from capabilities

Replace the hardcoded Free/Plus/Pro strings with a total
`Record<Capability, string>` of user-facing labels in `packages/shared`.

A total record makes **adding a capability without labelling it a compile error** — the
exact bug that silently dropped Screener from the Plus line. Precedent already exists in
the same package: `SELECTOR_TIERS` and `COUNTS_AS_CLEANUP` are total records for this
reason. The asymmetry worth closing is that the codebase applies this discipline to money
and quota but never to user-facing labels, which is why the packaging change updated every
price correctly and lost one marketing sentence.

---

## 6. Bundle constraint

`ActionPreviewPresentation` documents a deliberate decision: the public simulator leaves
`accountContext` empty, _"removing this preview's auth/query edge from the public
route-specific chunk."_

`BatchActionSheet` and `ConfirmModalFrame` both import `MailboxActionContext`, which
imports `auth-provider`, which imports `useMe` (TanStack Query) and the API client.
Importing them as-is drags the query layer into the public marketing chunk. Tree-shaking
does not save this: it is per-module.

**Targeted refactor:** split `MailboxActionContext` into a presentational core taking
`mailboxEmail: string | undefined`, plus a thin auth-reading wrapper for app surfaces. The
component already carries a `mailboxEmail` override documented _"for isolated previews"_ —
the design intent exists, the module boundary was never cut.

**Verify by chunk membership in `app-build-manifest.json`, never by chunk name.**

---

## 7. Fixtures

Six adjacent `amazon.com` senders added to `apps/web/src/features/triage/data.ts`,
carrying deliberately different signals so `runCascade` produces different verdicts, and
one with `protectionReason` set.

Adjacency matters: `findDomainBatches` requires a run of ≥3 **consecutive** rows sharing a
registrable domain.

**§5.1 constrains this work and must not be defeated by it.** Once verdicts derive from
`runCascade`, a fixture cannot simply declare "Amazon Advertising → Unsubscribe". The
signals have to _produce_ that verdict. So the fixtures are authored backwards: pick the
intended mix, then craft `SenderSignals` that make the cascade emit it, and assert the
mapping in a test. An implementer who hardcodes the verdict to hit the mock has removed
the entire point of §5.1.

Total goes 9 → 15 senders, landing inside D133's 15–20 range as a side effect.

---

## 8. Copy changes

| Surface                                      | From                                                   | To                                                                                               |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Simulator H1                                 | "Make three inbox decisions before you connect Gmail." | "Clear thousands by sender. On a made-up inbox, with nothing connected."                         |
| Bottom CTA                                   | `Connect Gmail →`                                      | `Review my Gmail senders →` — matches the standard the same page's completion block already uses |
| Plan strip Plus line                         | "Rules keep it clean for you"                          | Derived per §5.2; must name Screener                                                             |
| `action-semantics.ts` ×4, `app-shell.tsx` ×1 | "your plan's Undo window"                              | The uniform 30-day window                                                                        |

The undo copy hedges a variance that no longer exists: all five tiers carry
`undoWindowDays: 30`, so `MIN_UNDO_WINDOW_DAYS === MAX_UNDO_WINDOW_DAYS === 30`, and the
hero already sells "30-day undo". **This one touches the real product, not only the demo.**

---

## 9. State, storage, analytics

- Guided scenario becomes a discriminated union: `{ kind: 'row' | 'batch' | 'rule' }`.
  Guided mode currently renders exactly one row (`rows = [currentScenario.row]`); step 1
  needs a card plus its members, and step 3 needs no row at all.
- Local synthetic `BulkActionPreviewResult` builder — no backend call, per D133.
- localStorage `v3 → v4`. The existing parser is strict and rejects unknown keys, so the
  bump is mandatory, and the v3 → v4 migration must be tested with a real v3 payload.
- Elapsed timer stamped in an effect, never during render — hydration safety, per the
  locale/zone pinning already done in #548.
- New analytics events for the batch decision and the rule activation, registered in
  `packages/shared/src/observability/events.ts` alongside the existing
  `demo_decision_confirmed` / `demo_preview_opened` / `demo_completed` / `demo_reset`.

---

## 10. Truth constraints

Non-negotiable. Each has already caused a shipped defect in this codebase.

1. **No future-mail claim** for manual actions. §3 Completion.
2. **No byte figures** on a Triage row. §3 Step 4.
3. **No fabricated engine output** — verdicts come from `runCascade`. §5.1.
4. **Autopilot is Plus**, not Pro, since 2026-08-23.
5. **The elapsed timer is measured**, never a written-in number.
6. Trust badge copy stays `We never fetch or store full email contents.` Counter-style
   claims are banned by CLAUDE.md §2.1.

---

## 11. Out of scope — flagged, not fixed

- **`.agents/product-marketing.md` states the badge is `Full bodies fetched: 0`** three
  times, including in the Objections table. CLAUDE.md §2.1 bans that exact string. Any
  agent doing marketing work reads that file and inherits the banned claim. The same doc
  is stale on packaging (seven-day undo, three inboxes, Screener-on-Plus described as
  not-yet-promisable).
- **The public changelog stops at 2026-07-29.** The entire August wave — the packaging
  change, Brief daily scheduling, Follow-ups — is invisible to a prospect evaluating
  whether the product is alive.

Both are the same drift class this spec addresses. Neither belongs in this change.

---

## 12. Verification

Structural gates are necessary and not sufficient (CLAUDE.md §8). Required:

- [ ] **Negative control per fix** — revert, watch the new assertion go red, restore.
- [ ] v3 → v4 localStorage migration tested against a real v3 payload.
- [ ] Chunk membership proved via `app-build-manifest.json` before and after the
      `MailboxActionContext` split.
- [ ] `runCascade` in the browser produces the same verdicts as the worker for the same
      signals — one shared test vector, both call sites.
- [ ] Capability-label record is total; adding a capability without a label fails
      typecheck. **Test the blind case first:** a guard that passes over an empty set has
      verified nothing.
- [ ] Full smoke of all four steps plus Explore, on desktop **and** mobile — steps 1 and 3
      mount app-surface modals that have never rendered on a public route.
- [ ] Every state: mid-step reload, back-out of a sheet, dismissed batch, reset,
      completion, replay.
