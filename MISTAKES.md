# Mistakes — DeclutrMail

Append-only log of mistakes and the rules added so we never repeat them.

See CLAUDE.md §11. Append when a gate fires, a bug ships and is caught
later, or an approach turns out wrong.

## Entry format

```markdown
## YYYY-MM-DD — Short title
**PR:** #NNN (link)
**Caught by:** <gate name | manual test | user report | production>
**What happened:** factual description
**Correct approach:** what should have been done
**Rule:** <one-line, immediately actionable>
**Enforcement update:** <hook change | agent prompt update | CLAUDE.md edit | none>
```

---

<!-- Entries go below. Newest at the top. -->
## 2026-08-06 — Wrote my own privacy contract instead of reading the one we publish

**PR:** [#473](https://github.com/CT2689-Tech/DeclutrMail/pull/473)
**Caught by:** Codex stop-time review, ten consecutive rounds — after CI green and after a passing dev smoke each time

**What happened:** New server-side sync telemetry. Round one: the failure
emit sat in a `finally` whose commit message read *"a failure dashboard
that under-counts precisely when the database is unhappy is worse than no
dashboard"* — and then resolved the owner's `userId` with a database read
**inside the same try that guarded the emit**. A database failure meant no
event. The `finally` guaranteed nothing; the sentence describing it was
false about the code beneath it.

Rounds two and three were one defect seen from both sides.
`sync_started` fired on every attempt, but a retryable failure never
reaches `onTerminalFailure` (`BaseDeclutrWorker` emits `worker.retried`
and rethrows), so attempts 1..n-1 left starts with no completion — at
`maxAttempts: 5`, five starts against one completion, a 20% success rate
for a sync that worked. I gated it to attempt 1 and shipped the exact
mirror image: attempt 1 can throw before reaching the emit (the
eligibility read and the readiness query are both database calls), so the
completion arrived with no start. Two placements, two orphan directions,
same root: a run spans several BullMQ attempts and the worker holds no
state between them, so once-per-run is not expressible there at all.

The tell was present from round one and I read past it twice. The no-op
guard's own comment named the defect — *"a `started` with no `completed`
would invent a failure that never happened"* — one screen above the code
committing it. I tested the case I had argued about and none of the cases
that same argument covered.

Rounds four and five are the ones worth keeping, because the correction
itself needed correcting. Having deleted `sync_started` for being unable
to fire exactly once, I wrote that `sync_completed` fires "exactly once
per run" — in the taxonomy, in the interface docblock and in the PR body.
Told that was wrong, I changed it to "at-least-once-ish" — which is also
wrong, in a way my own text refuted two lines below it: at-least-once
means never zero, and I had just documented a zero case in the same
table. The event has NO delivery guarantee. It can arrive twice, once or
never, and every loss is silent (`captureServerEvent` is fail-open,
`capture()` is fire-and-forget, SIGKILL loses the buffer). The same
document called the server emitter "authoritative" two paragraphs after
saying only stateful storage could be. Both sentences were mine.

The substantive part is not the vocabulary. **The loss mode correlates
with what is being measured**: an OOM or a revision swap both CAUSES sync
failures and SUPPRESSES the events that would report them, so a success
rate derived from this event is biased optimistic exactly during an
incident — the same "surface asserting what it does not know" defect as
everything else in this PR, one layer up, in the dashboard rather than the
emitter.

Checking the consent path while fixing it turned up a second live defect,
and I then fixed only half of THAT too. The event was attributed to
`users.id`, but analytics consent (D147) lives in browser localStorage
with decline as the default and is unreadable from a worker, so the
attribution would have built a PostHog person profile for users who
declined via a path that never consults the gate. I removed the distinct
id and called it done — leaving `mailbox_id` on the payload and a
`sync_id` of `mailboxId:epochMs`. Either is a stable per-user key, so
PostHog still held per-mailbox behaviour for people who refused it.
Pseudonymous is not anonymous, and identity is a property of the whole
payload, not of the distinct-id field. Round six.

I stripped every user-linked field — `sync_id` became
`telemetryReference(runKey)` — and argued that an anonymous payload is not
personal data, so consent does not apply. Round seven: that was me
authoring a contract instead of reading ours. Our published pages say
"Optional analytics (PostHog) is initialized only after you accept it",
"withdrawal takes effect immediately", and "Choosing Essential only stops
analytics immediately". The promise is that PostHog does not RUN, not that
it runs without names. Anonymising cannot satisfy a promise about whether
a third party receives anything at all.

Twice in a row I reasoned about what counts as personal data when the
answer was written in our own `/privacy` and `/cookies` pages, sitting in
this repo. The whole server-side emitter came out. What shipped is the
part with no consent surface: `unreadable` on the result and in the
`worker.succeeded` allowlist, plus the taxonomy corrections the work
surfaced. The metrics belong in a first-party `sync_runs` table — the
founder's own 2026-05-22 D-candidate — where the optional-analytics gate
does not apply and which fixes the delivery and bias problems too.

**Correct approach:** delete the event rather than patch its placement a
third time. `sync_completed` alone carries outcome, real duration, real
counts and the finishing `attempt`; runs that begin and never finish
already belong to `scripts/check-sync-stuck.sh`, which reads
`provider_sync_state` and is stateful enough to answer. `sync_id` is
anchored to `job.timestamp` (`WorkerContext.enqueuedAt`) so the id names a
run rather than an attempt, and the owner lookup is best-effort
(`userId: string | null`) so a database incident costs the person-level
join and not the event. For rounds four and five: state that there is NO
delivery guarantee, enumerate the loss paths, say which deviation the
design actually neutralises (duplicates, via `COUNT(DISTINCT sync_id)` on
the `enqueuedAt` anchor) and which it does not (losses, silently), name
the correlated-loss bias so nobody reads the dashboard as proof, and stop
calling the event authoritative when a table already is. Drop the user
attribution entirely rather than gate it on consent we cannot read.

Round nine closed the loop on the rule itself. Having removed the
emitter, I narrowed `sync_id` to `null` in `events.ts` and wrote that a
future server emitter "cannot quietly supply an id without hitting a
compile error". It could: `captureServerEvent` takes `event: string,
properties: Record<string, unknown>` and never consults the event map, so
the narrowing constrains only the FE `track()` path. I claimed a
compile-time guarantee without compiling the thing it was supposed to
stop — the exact rule this entry already states, broken while writing it
down. The fix is a real gate at the call site (`ServerEmittableEvent`,
the two names that ship), verified by an actual probe file: `Argument of
type '"sync_completed"' is not assignable to parameter of type
'"email.delivered" | "email.bounced"'`.

Round ten caught the last of it. Having written "no server-side code may
emit to PostHog at all — a hard block", I shipped a type permitting two
names and described it as "not an approval list". A list of what may pass
IS an approval list; calling it something else does not change what it
does, and it contradicted the contract one file over. The two Resend
calls are an open VIOLATION of the rule, not an exception to it — so the
type is now `UnremediatedServerEvent`, a frozen debt list documented as
expected to shrink to empty, and both the taxonomy and F004 say plainly
that a change growing it is adding a violation.

**Rule:** when a comment or commit message claims a guarantee ("always
counted", "never blocks", "exactly once", "the type prevents it"), the
very next move is a test that starves the mechanism the guarantee rests
on — for a compile-time claim that means writing the offending code and
watching `tsc` reject it, not reasoning that it would — a
guarantee with no test for its own failure mode is a wish. When the second
placement of a signal fails the way the first did with the sign flipped,
stop moving it: that is a signal the layer cannot produce, and the fix is
to delete it and name the surface that can. A delivery guarantee is never
a property of the emitting code alone — it is a property of the emitter,
its transport, and how the process can die; fire-and-forget from a
killable worker has NO guarantee, so publish the dedup key, the
aggregation rule and the loss paths alongside the event instead of a
promise. **Before trusting any derived reliability metric, ask whether its
loss mode correlates with the thing it measures** — if the same incident
that causes failures also drops the events reporting them, the metric is
biased precisely when it matters, and only stateful storage can answer.
**A consent gate protects a PAYLOAD, not a field** — anything derived or
composite counts, not just the distinct-id. **And when a change touches
consent, privacy, or retention, the controlling document is what the
product PUBLISHES, not what the code implies or what the law would
tolerate**: read `/privacy` and `/cookies` in the repo first, quote the
sentence the change has to satisfy, and if the answer is arguable it is
the founder's (CLAUDE.md §9), not yours to reason to. **And when an
absolute rule meets code that breaks it, name the code a violation and
bound it — never soften the rule into an allowlist that admits the
exception**, because the allowlist is what the next author reads.

**Enforcement update:** structural test asserts `SyncTelemetry` exposes
`syncCompleted` only, so re-adding a start reopens the class loudly rather
than quietly. Recorded as the second instance of the UI-truth class
landing in *telemetry* rather than UI (see `[[ui-truth-bug-class]]`); a
third promotes it to a CLAUDE.md §2 candidate covering "surfaces that
assert what they do not know" beyond the frontend.

## 2026-07-31 — Four rounds of enumerating variants instead of recognising the thing
**PR:** [#454](https://github.com/CT2689-Tech/DeclutrMail/pull/454)
**Caught by:** Codex stop-review, four consecutive times on ONE change
**What happened:** Fixing a telemetry leak, I patched the exact case named and shipped, four times running: (1) stripped the query, left the fragment / allowed-param values / userinfo; (2) constrained param values in the URL, left the SDK's extracted copy of the same param; (3) matched `utm_*` and `$initial_utm_*`, left `$session_entry_utm_*`. Each fix was correct for the instance and blind to its siblings, and each round the reviewer had to name the next one. The tell was there from round one: I was writing lists of shapes I had seen — components, prefixes, key names — where the safe form was to recognise the one part that carries meaning and rebuild everything else from an allowlist.
**Correct approach:** When a fix is "add the case that was reported", stop and ask what the case is an INSTANCE of, then close that. Here: a URL is not its query (rebuild from origin+path+allowlisted params), and a campaign property is not its prefix (match the NAME wherever it ends the key).
**Rule:** After any reviewer-reported leak, before committing, write down the axis the report varies along — component, prefix, copy, encoding — and enumerate that axis to exhaustion yourself. If you cannot enumerate it, the fix must be reconstructive rather than subtractive. See also this session's two other entries: all three are the same failure to distinguish the instance from the class.
**Enforcement update:** none — each variant has its own test and each has a passing negative control. The lasting artifact is the shape of the code: `stripUrlQuery` rebuilds, `isCampaignPropertyKey` matches by name.

## 2026-07-31 — Subtracted the part I thought of instead of rebuilding from safe parts
**PR:** [#454](https://github.com/CT2689-Tech/DeclutrMail/pull/454)
**Caught by:** Codex stop-review ("still permits sensitive values through allowed parameters and fragments") — probing on top of that found a third path
**What happened:** Fixing a URL leak in telemetry, I stripped the query string. A URL has more components than a query: the FRAGMENT went out whole (and a fragment-only URL skipped the function entirely, because my fast path keyed on `?`), the VALUES of allowlisted params were never constrained (`?utm_content=<address>`, `?ref=<address>`), and `user:pass@host` userinfo survived. Five paths, three shipping. I had allowlisted param NAMES and called it an allowlist — a name allowlist constrains who may speak, not what they may say.
**Correct approach:** For a boundary, REBUILD the value from the parts that are safe rather than removing the parts you thought of. `origin + path + allowlisted params with allowlisted values` closes the components nobody has enumerated yet; subtraction only ever closes today's list.
**Rule:** A sanitizer that REMOVES known-bad is a denylist wearing an allowlist's name. If the thing being sanitized is structured, reconstruct it from permitted components — and constrain values, not just keys.
**Enforcement update:** none — each of the five paths has its own test, and the negative control (restoring the subtractive version) fails three of them. Related and worth reading together: the same session's `seen.has(x) → return x` bypass, also a case of the guard's NAME describing something narrower than the hole.

## 2026-07-31 — A "cycle-safe" WeakSet that was really a scrub bypass
**PR:** [#454](https://github.com/CT2689-Tech/DeclutrMail/pull/454)
**Caught by:** Codex stop-review ("cyclic payloads bypass the new URL scrubber")
**What happened:** Both telemetry scrubbers walked the object graph with `if (seen.has(x)) return x` — returning the RAW input on a repeat visit. Written and reviewed as cycle protection; it is a bypass. The second appearance of any object came back unscrubbed, and it needs only a SHARED REFERENCE, not a cycle — `{a: msg, b: msg}` put a full Gmail body on the wire under `b`. The cycle framing is what hid it: a true cycle dies in the SDK's own `JSON.stringify` and never ships, so the only reachable case was the one the name did not mention. `scrubObject` had carried this since it was written; I copied the line into `scrubUrlQueries` without questioning it.
**Correct approach:** Memoize the OUTPUT, not membership — a `WeakMap` holding the scrubbed container, registered before recursing. The cycle then resolves to the scrubbed copy, shape survives, and every node is scrubbed exactly once.
**Rule:** `seen.has(x) → return x` is never correct in a TRANSFORMING walk; it is only correct in a read-only one. If the walk produces a new value, the visited-set must map input → output.
**Enforcement update:** none — tests now assert one level DOWN (`out.self.$current_url`, `out.two.body`) on both scrubbers. My first cycle test checked only the top-level value and passed while the child still carried the address: a test shaped so it could not observe the bug it was named for. Same failure as the 2026-07-31 un-cancel race test earlier in this session — **when a test is named for a structural hazard, assert past the first hop.**

## 2026-07-31 — Let a caller infer a fact's SUBJECT from the state it was correcting
**PR:** [#452](https://github.com/CT2689-Tech/DeclutrMail/pull/452)
**Caught by:** Codex stop-review ("refutation logic can miss or erase the wrong billing verdict")
**What happened:** I had the Paddle adapter answer a bare `'refuted'` — one boolean covering two independent facts, "the refund was rejected" and "the chargeback was reversed". The caller then decided WHICH by reading its own `cancel_source`. A row holding a pending refund, on a subscription whose unrelated older chargeback had been reversed, got its refund verdict lifted; Paddle had never rejected that refund. The same collapse hid a second bug: refund refutation checked only `rejected`, so an approved-then-`reversed` refund was neither settled nor refuted and its verdict stood forever.
**Correct approach:** Return the facts as the source holds them (`{settled, refuted: {refund, chargeback}}`), and let the caller match them against its own state explicitly. A single flag standing for several subjects always pushes the disambiguation onto someone who does not have the information.
**Rule:** When one value could describe more than one subject, name the subject in the value. Never let a caller infer it from the very state the value is supposed to correct — that reasoning is circular and fails exactly when the two disagree, which is the only case that matters.
**Enforcement update:** none — the adapter spec now pins each shape separately, including "a reversed chargeback beside a pending refund refutes neither the refund", and the reconciliation spec's negative control (lift on any refutation) fails that case.

## 2026-07-31 — Filed a hazard my own PR created as a "known limitation"
**PR:** [#452](https://github.com/CT2689-Tech/DeclutrMail/pull/452)
**Caught by:** Codex stop-review ("pending refunds can cancel subscriptions before Paddle approves them")
**What happened:** I added an outbound provider cancel driven by a local `cancel_source` marker. I then discovered, and wrote in the PR body under "Known limitation, recorded not assumed away", that live Paddle refunds are created `pending_approval` — so the marker can exist for a refund Paddle later rejects. I filed a followup and shipped. But the limitation was pre-existing only for the LOCAL revocation, which is a row we can fix; my change made it cancel a possibly-still-paying customer's subscription at the provider, which they cannot undo. Naming a risk is not the same as owning it, and the founder has explicitly rejected the ship-a-stub-with-a-note pattern before.
**Correct approach:** When a change makes an existing gap MORE consequential, that gap becomes part of the change's scope. The test is not "did this exist before" but "does my change raise its cost". Here the fix was small: ask the provider whether the refund actually settled, instead of trusting our own marker.
**Rule:** Before filing a limitation as a followup, ask whether this PR made it worse. If it did, it is not a followup — it is unfinished work.
**Enforcement update:** none — the gate is `settledCancellationCause`, and the reconciliation spec's fake adapter now defaults to the REFUSING answer so a test that forgets it cannot drift into sending a cancel.

## 2026-07-31 — Treated every refund as an exit, because the event does not say so
**PR:** [#452](https://github.com/CT2689-Tech/DeclutrMail/pull/452) (fix); shipped originally in 0051
**Caught by:** reading the Paddle adjustment schema while building the provider-side cancel — not by any test, gate, or smoke
**What happened:** `adjustment.created` with `action: 'refund'` ended the subscription's entitlement, full stop. Paddle fires that same event for a full refund and for a $2 goodwill part-refund, and the handler read only `action` — so apologising to a customer with a partial refund silently cancelled their plan. It survived because every test and every smoke I wrote used a full refund: the fixture had no `items` at all, so the field that distinguishes the two cases was never in front of me. Adding the provider-side cancel would have escalated it from "wrongly downgraded" to "cancelled at Paddle".
**Correct approach:** When a handler branches on one field of a provider payload, read the provider's schema for that entity and ask what ELSE arrives on the same event type. Here `type`, `status`, and `items[].type` all carry meaning we were discarding — including `status: 'pending_approval'`, which live accounts use and sandbox never does.
**Rule:** A fixture that omits a field asserts that field is irrelevant. Before trusting one, diff it against the provider's own documented example — and make every discriminating field explicit in it, even when the test does not vary it.
**Enforcement update:** none — `paddleAdjustmentCreated` now takes `itemTypes` and the specs pin full, partial, mixed, empty, and chargeback shapes.

## 2026-07-30 — Diagnosed a two-input derived gate against only one of its inputs
**PR:** none — FOUNDER-FOLLOWUPS entry written during D249 CI triage, corrected same day
**Caught by:** observed CI behavior contradicting the prediction (#436 merged closing D249; the gate I predicted would fail on the next PR passed)
**What happened:** `generate-impl-log` derives the ROW SET from the plan mirror and the STATUS from merged PR trailers. I diagnosed the #435 failure correctly (existing rows, merged flips, next PR fails) then generalized it to #436 — but D249 had no plan entry, so there was no row to be stale: the gate stayed green and the D was silently untracked instead. I recorded a confident, wrong prediction in FOUNDER-FOLLOWUPS as the basis for a founder decision.
**Correct approach:** Before predicting a derived artifact's failure mode, enumerate its inputs and trace the specific case through EACH — "absent from the log" has two causes here (unmerged trailer vs. missing plan row) with opposite consequences (loud failure vs. silent untracking).
**Rule:** A derived gate drifts once per input; diagnose against every input before predicting, and prefer running the generator over reasoning about it (`pnpm generate-impl-log` + diff would have shown no D249 drift in seconds).
**Enforcement update:** FOUNDER-FOLLOWUPS entry rewritten with both drift classes; Class-B rule now in effect (a PR shipping a new D appends it to the plan mirror + regenerates the log in the same PR — done for D249).

## 2026-07-30 — Three Codex rounds on D249: each safety rule died at the boundary of the case it was scoped to
**PR:** [#436](https://github.com/CT2689-Tech/DeclutrMail/pull/436)
**Caught by:** Codex stop-time review, three consecutive rounds on the same feature
**What happened:** Billing reconciliation (D249) shipped with three correctness holes, each an assumption that was TRUE in the case I designed for and false one boundary over. (1) `fetchSubscription` collapsed "exists in a pre-grant status" into "not found" — correct for 404s, false for the 3DS window, so the UI said "no payment found" seconds before a charge could settle. (2) A claimless reconcile returned `no_pending` without asking any provider — correct while claims outlive locks, false after the 30-min TTL sweep, exactly the stale-lock case the feature targets; the FE then rendered it as "Found your payment" (observed live on the founder's screen). (3) Razorpay's search was a `[]` no-op justified by "every Razorpay claim carries `provider_ref`" — true of claims, false of stale locks whose claim row was swept, and the ref itself was later shown non-conclusive (rotten refs; reclaimed claims pointing at attempt #2 while attempt #1 carried the money) plus a single-page listing that hid matches past 100.
**Correct approach:** For each safety-relevant "X always holds" in a design, name the boundary where X stops holding and test THAT case first — the stale/expired/reclaimed/paginated variant, not the fresh one. Fast paths must fall through, never conclude: a lookup that can be inconclusive may short-circuit success but must not short-circuit to "nothing exists." And when two code paths share an acceptance decision, extract one predicate so they cannot disagree.
**Rule:** Any negative outcome the user can act on ("no payment found") must be reachable ONLY after every source that could contradict it has actually been asked — count the sources in the code path, not in the design doc.
**Enforcement update:** `filterMatches` is the single shared acceptance predicate in billing-reconciliation.service.ts; the search fallback is structurally unconditional when the ref path yields no accepted match; truncated provider listings log `reconcile_search.truncated` so a cap can never read as full coverage. Recorded here for the distillation trigger — this is the third 2026 entry whose root shape is "guard verified the case it was written for, not the boundary."
## 2026-07-28 — A shell footgun wiped 30 merged PR bodies (fully recovered)
**PR:** none — `gh pr edit` bulk operation during the D158 derived-log work
**Caught by:** the very next generator run deriving D38 from PRs whose bodies should no longer say `Closes D38`, then direct length checks
**What happened:** A bulk trailer rewrite piped each PR body into `python3 - "$arg" < file <<'PY'`. The file redirect and the heredoc both bind stdin: python received the PR BODY as its *program*, died with SyntaxError, and wrote an empty stdout — and because `set -e` does not propagate out of a function invoked in a loop under zsh, the loop marched on. The next step diffed original-vs-empty, saw a difference, and `gh pr edit --body-file`'d the EMPTY file into 30 merged PRs. Every safeguard that would have caught it was absent: no pre-snapshot, no non-empty sanity check on the replacement, no single-PR trial before the loop.
**Correct approach:** Recovery worked because GitHub keeps `userContentEdits` per PR (GraphQL): the newest non-null `diff` node is the pre-wipe body. All 30 restored full-length with the intended trailer fix applied in the same write, verified by length + old-trailer-absent + replacement-present on every one, plus `Closes D49` surviving untouched on #341. Second bug found during the redo: the replacement regex was case-SENSITIVE while the generator's is case-INSENSITIVE, so a lowercase `closes D38` (#69) still derived — matcher and rewriter must share one pattern.
**Rule:** Bulk-editing anything remote: (1) snapshot every current value to the scratchpad BEFORE the first write; (2) trial the transform on ONE item and verify the result end-to-end before looping; (3) the write step must refuse content that is empty or missing an expected marker; (4) any regex that undoes what another regex matches must use the same flags.
**Enforcement update:** none mechanical — recorded here; the restore script pattern (GraphQL userContentEdits) is in the session transcript for reuse.

## 2026-07-28 — Closed two followups on the half of their status that said "shipped"
**PR:** [#421](https://github.com/CT2689-Tech/DeclutrMail/pull/421)
**Caught by:** Codex stop-time review (first instance), then a mechanical sweep of every closure in the same change (second instance)
**What happened:** Triaging FOUNDER-FOLLOWUPS.md, I closed 31 entries as verifiably dead. Two of them were not. Both had a **Status line reading `Open` above a body describing work that had shipped** — and in both cases the shipped part was the setup and the unshipped part was the entire point of the entry. The `read_count` RATIFY said "founder ratified the rename… PR-A already ships `read_count`. **Remaining: the plan-file edit**"; I read as far as "already ships" and wrote "No open action." The plan mirror still contains zero occurrences of `read_count` and still declares `opens int` at line 1659, so it names a metric Gmail cannot produce. The `/billing` post-purchase entry stated its own two-part bar — "#367 merges **and** one sandbox purchase flips in place" — and I closed it having verified only the merge, which is precisely the overclaim shape the fix in #367 existed to eliminate.
**Correct approach:** An entry's `**Status:**` prose and its `**Verifies by:**` line are the exit criteria; the `**Why:**` is background. Read the criteria and check each conjunct separately. When a status narrates progress, the sentence that matters is the one after the progress.
**Rule:** Before closing any followup, grep its ORIGINAL status for `remaining|still|awaiting|pending|founder action|not yet` and satisfy every conjunct of its `Verifies by` line — a partially-met criterion is an open item, not a closed one.
**Enforcement update:** Rule recorded in the reopened entries and in the "seven calls" brief at the top of FOUNDER-FOLLOWUPS.md Open, so the next triage inherits it. The sweep that caught the second instance is the mechanical form and is cheap to re-run.

## 2026-07-28 — Renaming a JWT claim silently killed every unsubscribe link already in someone's inbox
**PR:** [#406](https://github.com/CT2689-Tech/DeclutrMail/pull/406)
**Caught by:** Codex stop-time review
**What happened:** Fixing the scope bug (entry below) renamed the token claim `category` → `scope`. Tokens in already-delivered mail still carry `category`, so `verifyUnsubscribeToken` read `undefined` and returned `null` — and because the endpoint answers a **uniform 200** to avoid being an enumeration oracle, the click reported success and did nothing. A dead unsubscribe link that looks like it worked, which is the exact failure the surface exists to prevent. Not hypothetical: the founder's own smoke emails carry `category` tokens. The self-indictment is that the same commit's comment said *"a link already sitting in an inbox must not break"* — I applied that reasoning to future granular tokens and not to existing ones.
**Correct approach:** Accept the legacy claim on read. `scope` wins when present; otherwise a valid `category` claim maps to `'all'` (the control it was minted behind said plainly "Unsubscribe", and the endpoint can only turn things OFF, so it is the more protective reading). Signing only ever emits `scope`. Regression test mints a token exactly as the pre-rename signer did.
**Rule:** A credential with no expiry that is embedded in something already delivered — email, QR code, printed link — is a permanent wire format: you may add claims, never rename or remove one. Note the interaction that makes it dangerous: a "no oracle" uniform-200 contract converts every such break into a SILENT one.
**Enforcement update:** none (legacy-claim regression test in `unsubscribe-token.spec.ts`).

## 2026-07-28 — A link labelled "Unsubscribe" stopped one category and left its sibling sending
**PR:** [#406](https://github.com/CT2689-Tech/DeclutrMail/pull/406)
**Caught by:** Codex stop-time review
**What happened:** The one-click token carried the category of the email that happened to contain it, so clicking **Unsubscribe** on a sync-complete email set `syncComplete=false` and left `reminders=true` — the 24h nudge still arrived the next day. Two failures compound: mechanically CAN-SPAM §316.5 permits a preference menu but requires an option that stops ALL commercial mail; and the confirmation page asserted *"You will still receive required account notices, such as billing and account deletion"*, which tells the reader everything else has stopped. That sentence was false — an affirmative misrepresentation on the page, worse than the missing behaviour. The predictable user response to "I unsubscribed and it kept coming" is a spam complaint, which is also the metric Gmail's bulk-sender rules police.
**Correct approach:** The generic control means ALL. Token now carries `scope: 'all' | keyof EmailPrefs`; every email ships `'all'`; granular control lives on the settings screen. `'all'` expands from `Object.keys(EmailPrefsSchema.shape)` — never a hand-written list, so a category added later is covered automatically instead of silently escaping. Page copy now states plainly what stops. The single-category scope is retained (not dead code) because these tokens never expire: a granular link minted later must stay verifiable, and a link already sitting in an inbox must not break.
**Rule:** A control's blast radius must match its LABEL, not its point of origin — if it says "Unsubscribe" with no qualifier, it stops everything optional; and any set the word "all" expands to must be derived from the schema, never enumerated by hand.
**Enforcement update:** none (PGlite tests pin both the all-scope sweep and the schema-derived category list).

## 2026-07-28 — The atomic jsonb merges regressed malformed ROOT bags the JS spread had tolerated
**PR:** [#405](https://github.com/CT2689-Tech/DeclutrMail/pull/405)
**Caught by:** Codex stop-time review (fourth pass on the same surface)
**What happened:** The atomic conversions (entries below) guarded a non-object `emailPrefs` SUB-bag but assumed the ROOT of `users.preferences` is an object. jsonb `||` on an array/scalar root CONCATENATES into an array (`'[1,2]' || '{"a":1}'` → `[1,2,{"a":1}]`), and `jsonb_set` with a text path on an array root RAISES an error — a 500 on the endpoint whose contract is a uniform 200. The replaced JS `{...spread}` had degraded a malformed root to an object, so the "safer" SQL was strictly worse on that input. Verified against real Postgres before fixing.
**Correct approach:** Repair the root in the same statement — `CASE WHEN jsonb_typeof(preferences) = 'object' THEN preferences ELSE '{}'::jsonb END` as the base of every merge (all four statements), with PGlite tests seeding array roots.
**Rule:** When replacing a JS merge with jsonb operators, enumerate non-object inputs at EVERY level of the path, not just the level being patched — `||` corrupts on a non-object root and `jsonb_set` throws on it, and the behavior parity you owe is with the code you deleted.
**Enforcement update:** none (array-root tests pinned in `users.service.spec.ts` + `unsubscribe.controller.spec.ts`).

## 2026-07-27 — Called the unsubscribe atomic, while every OTHER preference writer could still undo it
**PR:** [#405](https://github.com/CT2689-Tech/DeclutrMail/pull/405)
**Caught by:** Codex stop-time review (third pass on the same endpoint)
**What happened:** After making the one-click flip a single `jsonb_set` statement, I declared the lost-update fixed. But the invariant "an unsubscribe stays applied" is a property of every writer to `users.preferences`, not of my statement: `UsersService.patchPreferences`, its onboarding clone, and the email-prefs PATCH all did JS read-modify-write of the whole bag — any of them landing after a concurrent flip wrote their stale snapshot back, silently resubscribing the user (8 call sites: active-mailbox switch, settings sub-bags, onboarding keys, the email toggles themselves).
**Correct approach:** Convert the writer CLASS: `patchPreferences` became an atomic top-level `preferences || $patch::jsonb`; the email-prefs PATCH now forwards only the keys it carries into a new `mergeEmailPrefs` (nested atomic sub-bag merge) instead of persisting a JS-materialized full bag. Verified on PGlite (semantics) and real postgres.js (param path). Fixed alongside `c1ea58c7`'s statement in the same PR.
**Rule:** A concurrency invariant is only as strong as the weakest writer to the row — after making one path atomic, sweep every other writer to the same column and convert them too (fix the class, not the instance).
**Enforcement update:** none (PGlite tests in `users.service.spec.ts` pin the only-carried-keys semantics).

## 2026-07-27 — The "raw merge" unsubscribe fix was still a read-modify-write race
**PR:** [#405](https://github.com/CT2689-Tech/DeclutrMail/pull/405)
**Caught by:** Codex stop-time review (second pass — the first fix survived one review round)
**What happened:** The parser-defaults fix (entry below) kept the SELECT-then-UPDATE shape, just merging the raw bag instead of parsed output. Under concurrency that is still a lost-update: a settings PATCH landing between the two statements gets overwritten by the handler's stale snapshot — which can resurrect a just-set opt-out and clobber sibling preference keys (`activeMailboxId`, `onboardingSkipped`). Mail scanners fire one-click POSTs at delivery time, so concurrent-with-user-activity is the normal case, not the edge.
**Correct approach:** One atomic in-database mutation: `jsonb_set(...)` computed from the row's current value under its row lock (single UPDATE ... RETURNING, no prior SELECT), with a CASE arm repairing a non-object `emailPrefs` because `jsonb_set` silently no-ops on a broken intermediate path. Tests moved from a fake db to PGlite — a fake cannot exercise `jsonb_set` semantics, which is what made the first fix look done. Fixed in `c1ea58c7`; verified against real Postgres (shape after flip: exactly one key, siblings intact).
**Rule:** A guarantee about concurrent state ("only ever narrows") must hold in ONE statement — if the invariant spans a SELECT and an UPDATE, it does not exist; and test JSONB mutations on a real engine, never a fake.
**Enforcement update:** none (PGlite regression tests in `unsubscribe.controller.spec.ts`).

## 2026-07-27 — Unsubscribe write merged over parser defaults, so it could turn opt-outs back ON
**PR:** [#405](https://github.com/CT2689-Tech/DeclutrMail/pull/405)
**Caught by:** Codex stop-time review
**What happened:** The one-click unsubscribe controller built its write as `{...parseEmailPrefs(stored), [category]: false}`. `parseEmailPrefs` falls back to `DEFAULT_EMAIL_PREFS` (every category `true`) whenever the stored `emailPrefs` bag is malformed or carries a key the current strict schema doesn't know (e.g. written by a future release). Writing that materialized fallback back to the row meant an **unauthenticated** endpoint could flip a user's stored `false` back to `true` — the exact opposite of the "a stale token can only ever turn a preference OFF" property the module's own doc promised.
**Correct approach:** Read-path parsers with default fallbacks are for READS. A write path — especially an unauthenticated one — merges over the RAW stored bag and changes exactly the one key it is entitled to change, passing unknown keys through untouched. Fixed in `9645a9d7` with regression tests for the resurrect and unknown-key cases.
**Rule:** Never write a parser's default-filled output back to storage; a narrowing endpoint's write must be provably monotonic (only-off), which means merging raw stored state, not parsed state.
**Enforcement update:** none (regression tests added in `unsubscribe.controller.spec.ts`).

## 2026-07-27 — Planned an unsubscribe GET that any mail scanner could fire
**PR:** none yet (caught in the plan, `docs/superpowers/plans/2026-07-27-email-foundation.md`)
**Caught by:** Codex stop-time review
**What happened:** The RFC 8058 unsubscribe plan gave `GET /api/email/unsubscribe` the same handler body as the `POST` — both flipped the preference off. The spec that the plan was written from said the GET should "render a confirmation page"; the controller code in the plan ignored that and mutated directly. Mail clients and corporate security products (Outlook Safe Links, malware scanners, proxy warmers) prefetch links inside email without a human involved, so shipping it would have let a scanner unsubscribe users from mail they never opened — with no signal to anyone about why notifications stopped. The same review caught a second defect: three signatures typed as `JSX.Element`, which does not compile under React 19's `@types/react` (the global `JSX` namespace was removed; `TS2503`). Both were in a plan that had already passed my own self-review.
**Correct approach:** Only POST mutates. GET is read-only and renders a form whose button POSTs the token. Pin it with a test that calls the GET with a *valid* token and asserts zero writes — a test using an invalid token would pass against the broken version too.
**Rule:** An unauthenticated endpoint reachable from a URL inside an email must not mutate on GET; put the mutation behind POST and test the GET-with-valid-token-writes-nothing case explicitly.
**Enforcement update:** none yet — candidate for a `webhook-security-auditor` prompt line covering email-reachable routes, not just webhook controllers. Recorded here first per §11 (distil on recurrence).

## 2026-07-26 — "transient:" made a three-day Vercel monitoring outage look like weather
**PR:** #383
**Caught by:** reading the watchdog table properly while verifying an unrelated fix — the Vercel row said `🟡 WARN — transient: The operation was aborted due to timeout`, and checking the previous 8 runs showed the identical string on every one, across 3 days.
**What happened:** `runVendor` classified any timeout as `WARN` with the detail prefixed `transient:` — **assuming** rather than testing. Vercel's `/v1/billing/charges` streams FOCUS JSONL for the whole month-to-date and does not fit the shared 10s budget, so it timed out every single run. Vercel spend was unverified for at least 3 days while the table showed a reassuring yellow.

The code knew. The comment read "e.g. Vercel's billing endpoint, **which times out most days**" — the chronic failure was documented as a justification for the softened status instead of being treated as the bug. Second time in one session that a known-bad signal was reasoned *around* rather than fixed (the other: the Upstash comment citing the permanent Actions WARN as an argument about `WARN_IS_FAILURE`).
**Correct approach:** One retry turns the assumption into a test — a genuine blip succeeds on the second attempt, and two timeouts in a row is an observability outage, not weather. Root cause fixed too: `httpText` takes a per-call `timeoutMs` and Vercel gets its own 45s budget, since the path itself answers 403 in ~88ms unauthenticated, so it is the response body that is slow.

**The first fix was incomplete, and the review caught it (PR #384).** #383 left an exhausted retry at `WARN`, reasoning that a daily red would train the operator to ignore red. But `WARN` exits 0 and `WARN_IS_FAILURE` is never set in the workflow — so a vendor that could not be read at all still produced a **green run that notified nobody**. I had fixed the row's honesty and left the run's honesty broken: the watchdog was still telling the exact lie it exists to catch, one layer up.

The category error underneath it: `WARN`/`BREACH` are judgments *about a value we have*; `ERROR` means *we have no value*. Filing a double timeout as WARN put "never read it" in the same bucket as "read it, it's fine". It is now `ERROR` (exit 1). The anti-red-training argument had also gone stale in the same commit that quoted it — it was calibrated to Vercel timing out most days against the shared 10s budget, and the per-vendor timeout in that very PR removed that world.
**Rule:** Never label a failure "transient" without retrying to find out. If a comment justifies a soft status by noting the thing fails *most days*, that comment is a bug report. A degraded check must state what it does **not** know — and the check's own exit code has to carry that too, or the honest detail is buried under a green run nobody opens. When softening a severity, re-derive the justification against the state *after* your fix, not the state that motivated it.
**Enforcement update:** none mechanical. Fourth instance today of the same class — see the entry below for the §11 distillation case.

## 2026-07-26 — A guardrail warned on a ratio that could not cost money, and stayed yellow for months
**PR:** #382
**Caught by:** founder question — "How do we reduce GH action minutes? Is that 2000 per month? what are the cost implications?"
**What happened:** `check-vendor-limits.mjs` graded GitHub Actions as `WARN` at ≥80% of "included minutes", and the row had been sitting at **574% of 2,000** for months. The included-minutes allowance applies to **private** repos; DeclutrMail is public, and public repos bill $0 on standard GitHub-hosted runners. GitHub's own API says so unambiguously — `/actions/runs/{id}/timing` returns `"billable": {"UBUNTU": {"total_ms": 0}}` for a run whose `run_duration_ms` is 13,000 — and the check's *own* detail string printed `net spend $0.00` on the same line as the warning. The alarm and its refutation were rendered side by side in one table cell.

Worse, the codebase had already routed around it instead of fixing it: the Upstash comment argued against `WARN_IS_FAILURE` on the grounds that "the table already carries a standing WARN (Actions minutes at 538% of the included tier), so that would pin the workflow red forever." A false alarm had become load-bearing in the reasoning about a *different* vendor's threshold.
**Correct approach:** Grade on the quantity that can actually hurt. `netAmount` was already being fetched and already drove BREACH; the ratio was decoration that outranked it. Status now keys on spend alone, minutes are reported as context, and `usagePct` is omitted so the row renders `—` instead of a false near-breach percentage.
**Rule:** A threshold must be expressed in the units of the harm. If a check can print its own contradiction (`574%` next to `$0.00`), the percentage is not measuring the risk. And when a permanent WARN starts being *cited* in other decisions, it has already cost more than the signal it was meant to give.
**Enforcement update:** none mechanical — but this is the **third** instance today of a guardrail that cannot tell a real state from a null one (`[]`-on-failure, `NOT_FOUND`-vs-unreadable, and now ratio-vs-cost). CLAUDE.md §11 distillation triggers **#1 (recurrence ≥3)** and **#4 (cross-cutting)** are both met. Candidate §2 guardrail: *a monitoring surface must distinguish "measured and fine" from "not measurable here", and must grade in the units of the harm.*

## 2026-07-26 — Fixed the "captured-and-empty" lie one section at a time, three rounds
**PR:** branch `chore/d038-infra-snapshot-hardening` (371e1e00 → 2d3d4879 → 91674d5b)
**Caught by:** Codex stop-time review, twice — "failed GCP reads are still serialized as captured-and-empty", then "GCP `NOT_FOUND` is still conflated with an unreadable source"
**What happened:** `infra-snapshot.sh` had failed 8 consecutive nightly runs because a 403 from `gh secret list` reached `--argjson` as an empty string. I root-caused that correctly and fixed the one section, writing a commit message explaining at length that an empty array is a *claim* — "these are the secrets, and none changed" — about a list never read.

Then I shipped it with `safe_gcloud` still returning `[]` on failure, so every GCP read told exactly that lie: Secret Manager holding no secrets, both service-account IAM policies empty, all six Cloud Run reads empty. `sa_iam_state` was worst — a `// {}` coalesce whose only function was converting the failure sentinel into an empty policy, in a security drift detector. `atlas_state` had it from a different cause: grep piped from atlas under `pipefail`, so the `|| true` absorbing a no-match grep also absorbed an atlas that never ran, and an unreachable database serialized as `{"raw": ""}`.

Round two fixed all of those to `null` — and immediately over-corrected, collapsing a *definitive* answer into the unreadable bucket. `declutrmail-worker@` does not exist; the API says so plainly. Reporting that as "could not read" destroys the one drift signal that item needs, because creating that SA **is** the remediation in FOUNDER-FOLLOWUPS, and "still absent" must stay distinguishable from "we did not look tonight."

Round three split them: `{"not_found": true}` for the API's verdict, `null` for a read that did not happen. Match order turned out to be load-bearing — Google merges the two cases in one sentence ("does not have permission to access projects instance [...] (or it may not exist): Permission denied"), so an explicit permission/auth match must win, or a credentials outage serializes as every resource being absent. Error strings were captured from the live project rather than guessed; Cloud Run does not emit the NOT_FOUND token at all ("Cannot find service [x]").
**Correct approach:** When the diagnosis is "this code cannot distinguish *checked-and-clean* from *never-checked*", that is a statement about a defect CLASS, not a line — grep every sibling path answering the same question before claiming the fix. And when introducing a sentinel, enumerate the states the underlying system can actually be in *first*; I introduced a two-state encoding for a three-state world and had to be told.
**Rule:** A fix whose rationale is a general principle is not done until that principle has been run as a query over every instance it indicts. Write the rationale, then go looking for what else it convicts — and count the states before choosing the encoding.
**Enforcement update:** none yet — but this is the **fifth** occurrence of the class in this repo (dependency-free `/healthz` as the only uptime check, 46 days of silent Redis suspension; the vendor watchdog degrading to UNCONFIGURED-and-green when a shared secret is deleted; and the three above). CLAUDE.md §11 distillation trigger #1 (recurrence ≥3) and #4 (cross-cutting) are both met. **Candidate guardrail for the founder to distill:** *a health, drift, or monitoring surface must never represent an unreadable source as an empty or default one — unreachable, absent, and empty are three distinct states and must serialize distinctly.* This is the ops-layer form of the UI truth-bug class already tracked (null→0, unknown→"Ready").


## 2026-07-25 — Three UI-truth defects a full audit found on surfaces every gate had passed
**PR:** (this branch — launch audit session)
**Caught by:** manual test (local browser walk at 375/620/1280 px against the real 121k-message mailbox, cross-checked in psql)

**What happened:** three separate surfaces asserted something they did not know,
and all three shipped through green typecheck, green tests, and every structural gate.

1. **Autopilot suggestions named nobody — and, underneath that, the whole
   backlog was stale.** `senders.display_name` defaults to `''`, the read
   service normalises `''` → `null`, and the FE read that as "Sender details
   still syncing" *and* suppressed the address too, so 867 of 6,244 pending
   matches were permanently unidentifiable. Digging into why 25 of the first 50
   rows had no `senders` row at all exposed the real defect: the initial-sync
   rebuild DELETEs and re-inserts `senders` (delete + reinsert *is* the
   reconciliation), while `rule_match_log` is left alone. So after the
   2026-07-24 reconnect, **5,978 of the 6,244 pending matches pointed at rows
   the rebuild had re-created and 32 at rows that never came back — only 234
   were current.** Every one was an approvable Gmail mutation whose confidence
   and reasoning described mail the mailbox no longer held: a preview (D226)
   built on deleted evidence.
2. **"4768 actions" on a rule that performed none.** The apply worker writes
   `last_run_actions = matchesForRule.length` in both modes; the rule card
   printed it as "actions" even for an Observe rule sitting Off.
3. **Garbage in the mobile topbar.** The trust strip is `overflow: hidden` and
   `justify-content: center`; at 375 px it shrinks to 32 px around a 95 px child
   and painted the mid-slice of "UNDO WINDOWS" as the literal string "o wir" —
   on every authenticated screen, on the product's own trust surface.

**Correct approach:** derived state must be torn down with the thing it derives
from — the rebuild transaction owns that. The fallback chain must match what the
rest of the product already does (name → address → and only then "syncing"); a
count's label must be true in every mode the count is written in; and a strip
that cannot fit must be hidden, not clipped mid-word.

**Rule:** *if a surface cannot name the thing it is about to change, or its
evidence predates the current index, it must not offer to change it* — enforce
that in the read layer AND delete the derived rows where they are invalidated.

**Enforcement update:** `initial-sync.worker.ts` deletes every UNEXECUTED
`rule_match_log` row — `pending`, plus `approved AND NOT intent_applied` —
inside the same transaction as the `senders` teardown. Dismissed rows (the
user's decision) and executed rows (referenced by activity + undo) survive.
`SENDER_INDEXED_AT_MATCH_TIME` (`senders.created_at <= matched_at`) guards the
pending list, `pendingTotal`, and both approve paths, and the same currency test
guards `AutopilotActionWorker.loadEligibleMatches`, for mailboxes rebuilt before
that shipped. Specs lock all three.

Thirteen things worth carrying forward:
(a) A CSS media query cannot override an inline `display` — the first topbar fix
silently did nothing. Put responsive `display` in `tokens.css`, never inline.
(b) **My first fix tested existence, not currency** — "does a `senders` row
exist?" caught 32 of 6,010 bad rows (0.5%) and, worse, let a stale suggestion
resurrect the moment its sender was re-indexed. I then wrote that resurrection
up as "it self-heals". Codex's stop-time review caught it. When a fix makes a
symptom disappear, check whether the mechanism can run backwards.
(c) Hiding rows is not free: `rule_match_log_pending_dedup_uniq` covers pending
rows, so a hidden-but-present pending row blocks the sweep from ever recording a
current match for that (rule, sender). Any read-layer suppression of rows a
writer deduplicates against needs a matching cleanup, or it converts a stale
suggestion into no suggestion, forever.
(d) **I then scoped the cleanup to `resolution='pending'` and missed the
executable half.** Codex's second stop-time review caught it: a match sits at
`approved AND NOT intent_applied` between approval and the sweep — and Active
mode writes matches already-approved — so a rebuild in that window left rows
that `AutopilotActionWorker` would go on to EXECUTE against Gmail. A pending row
only misleads; an approved-unexecuted row mutates the user's mailbox. When
invalidating derived state, enumerate every state the pipeline can hold it in
and ask which of them a downstream *writer* consumes — "resolved = safe to keep"
was the wrong abstraction; "executed = safe to keep" is the right one.

(e) **And the cleanup itself was not synchronized with the workers that write
what it cleans.** `WORKER_POLICIES.perMailboxPolicy` says `concurrencyScope:
'perMailbox'`, but nothing reads that field — `apps/api/src/worker.ts:805` says
outright that per-mailbox concurrency=1 is not enforced at the consumer. So
`AutopilotApplyWorker` can read signals, have the rebuild commit under it, and
then insert matches from the pre-rebuild snapshot — rows that pass every
currency guard, because their `matched_at` is later than the rebuild's fresh
`created_at`. A deleting cleanup does not make a system consistent unless the
writers feeding that table are synchronized with it. The fix follows this repo's
existing pattern (ScoreWorker's monotonic upsert): correctness at the DB layer —
fingerprint `min(senders.created_at)` before reading and re-check before
writing. Reach for the invariant the writer can verify itself.

(f) **That fingerprint, on its own, was still check-then-act.** Codex's fourth
review: comparing the stamp and then INSERTing are two statements, so the
rebuild can commit in the gap and the stale matches land anyway. I had shrunk
the window and called it closed — the second time in this session I mistook a
narrower race for no race. The comparison and the write now share ONE
transaction holding a per-mailbox `pg_advisory_xact_lock` that the rebuild takes
too (`sender-index-lock.ts`); transaction-scoped, so there is no unlock path to
leak. Same review also caught that the `flipMatchApplied` warning fires AFTER
the Gmail mutation — it reported the race rather than preventing it — so the
currency predicate is now re-checked immediately before the mutation, with the
warning kept only for the residue. That residue is irreducible and worth stating
plainly rather than papering over: an external side effect can never be
transactional with a database predicate.

(g) **And "irreducible" was wrong.** I wrote that an external side effect can
never be transactional with a database predicate, so the mutation window had to
stay open. True in general, false here: this worker ALREADY writes a durable
`action_jobs` claim before mutating (key `autopilot-<matchId>`). Creating that
claim under the rebuild's lock, in the same transaction as the currency check,
serializes "decide to execute" against "invalidate" — either the claim commits
first and the rebuild skips the match, or the rebuild commits first and the
check fails before Gmail is touched. Declaring a race irreducible is a claim
about the whole system, not about the function in front of you; check what
durable state the pipeline already writes before asserting it.

(h) Extracting the shared predicate was not tidying. Written out twice —
`loadEligibleMatches` and `matchStillCurrent` — they drifted on the FIRST edit:
the claim escape hatch went into one and not the other, so a claimed match was
filtered at load and stranded exactly as designed-against. One `SQL` constant,
used by both. A duplicated predicate is a bug with a delay fuse.

(i) **Preserving the claim created a zombie.** Making claimed matches survive
the rebuild was right, but it collided with the older "sender row missing =
`building_sender_index` race, retry later" branch. When the sender genuinely
does not come back, that race never resolves: the cleanup skips the row (claim),
the currency predicate passes it (claim), and the sweep retries it forever with
`action_jobs` parked at `queued`. Every exemption you add to a cleanup needs the
question "what now retires this row instead?" — an exemption without a terminal
path is a leak. The missing-sender branch now separates transient from final by
the same index fingerprint (`min(senders.created_at) > matched_at` ⇒ the
teardown already happened, so the absence is permanent), terminates the match as
a no-op and flips the claim to `failed`.

(j) **The retirement I added to close (i) could strand a real Gmail mutation.**
`resolvedMessageIds` + `status='executing'` are persisted immediately BEFORE
`batchModify`, precisely so a crashed attempt can re-apply the same set. So a
non-`done` claim may mean the mail has ALREADY moved — and my retirement marked
it `failed` and flipped the match terminal with no `activity_log` row and no
`undo_journal` token. That is an archived-or-trashed set of the user's mail that
is invisible in Activity and unrecoverable: the single worst outcome this
product can produce, written while fixing a leak. Only a claim that never
advanced past creation (`status='queued'`, no resolved ids) is safe to drop;
anything further must COMPLETE, which it can — the execution set is persisted
Gmail ids and the audit row keys off `senderKey`, so neither needs the senders
row the guard was missing. `abandonStaleClaim` now re-asserts that condition
itself rather than trusting its caller.

(k) **And the protection I added for (j) was in the wrong place.** I guarded the
missing-sender branch, but that sits FOURTH in the per-match loop. Three guards
run before it — rule disabled/paused (`continue`, and a paused rule never
retries, so the mutation is stranded forever), non-preset key (`continue`), and
the Protect re-check (`dismissShieldedMatch`, which retires the match outright)
— plus the daily cap after it. Every one of them could strand or retire a
mutation that had already moved mail. The insight I kept missing: those guards
all answer "should we START this action?", and none of them may answer "should
we RECORD one that already happened". The in-flight check now runs FIRST, above
every start gate.

(l) **Then the SWEEP-level gates stranded them too.** Hoisting the in-flight
check to the top of the per-match loop still left two gates that `return` before
the matches are even loaded: the entitlement check (workspace downgraded off
Pro) and the quiet window. Quiet re-schedules, so it only delays the audit; a
downgrade never sweeps again, so an already-executed mutation stays invisible
and unrecoverable forever. Both now record a REASON instead of returning, and
the sweep falls through to a completion-only pass over the in-flight claims.
Three rounds running, the same fix kept landing one layer below the hole — the
lesson is to enumerate every exit from the code path FIRST (`grep` for `return`
and `continue` in the whole function, not just the block being edited) and only
then decide where the check belongs.

(m) **The gated-completion pass I added for (l) was an N+1.** It asked
`isClaimInFlight` per match, sequentially awaited, before the sweep did
anything — and `loadEligibleMatches` is unbounded, so a mailbox with a large
backlog paid thousands of serial round-trips per sweep. Correctness fixes carry
the same performance obligation as features: a guard added to the front of a
hot loop is on the hot path. One batched `inArray` lookup (chunked for bind
limits) replaces it, and the in-flight predicate is now a pure function shared
by the batch and single-claim paths so they cannot drift — the same duplication
that already cost this file a bug.

**Rule:** before terminating any record, ask what IRREVERSIBLE external effect
it might already have caused. A cleanup that cannot distinguish "never started"
from "already happened" must refuse to run, not guess. And when you add such a
check, put it where EVERY exit from the code path passes through it — one guard
protecting one branch just moves the hole.

**Rule (generalised):** "check, then act" is not a guard unless something holds
still between the two. Name what that something is — a lock, a single
statement, a durable claim, a monotonic column — or say out loud which window
stays open, and only after checking what the pipeline already persists.

## 2026-07-21 — Migration CHECK constraints not mirrored into the Drizzle schema
**PR:** #367 (https://github.com/CT2689-Tech/DeclutrMail/pull/367)
**Caught by:** schema-migration-reviewer gate (pre-commit review of the D120 working tree)
**What happened:** Migration 0048 added two CHECK constraints on `subscriptions` (`scheduled_change_state` enum + all-or-nothing completeness) but the Drizzle table config declared only columns and indexes — no `.check()`. CI cannot catch this drift: `drizzle-kit check` compares against a snapshot journal frozen at 0015, and atlas lint only scans SQL for dangerous ops, so the DB would enforce invariants the schema-as-source-of-truth never mentioned.
**Correct approach:** Every migration-level CHECK gets a matching `.check(name, sql)` in the Drizzle table config in the same change (the codebase convention — see `product-feedback.ts`, `sender-policies.ts`, `mail-messages.ts`).
**Rule:** Hand-authored migration adds a constraint ⇒ same PR mirrors it in `packages/db/src/schema/` with the identical constraint name.
**Enforcement update:** none (schema-migration-reviewer already checks this; it fired as designed).

## 2026-06-05 — Stale dev worker process from a prior session intercepted BullMQ jobs with pre-Delete-verb code

**PR:** (this branch — caught during D38 smoke 2026-06-05)
**Caught by:** manual Delete smoke fired with `unknown action verb delete` ValidationError despite the verb existing in every registry / enum (action_verb pg_enum, ACTION_REGISTRY, PIPELINE_COMPLETE_VERBS, ActionLabelAppliedPayloadSchema). Diagnostic console.logs added at `execute()` entry never fired even after a `./scripts/dev-up.sh --stop && ./scripts/dev-up.sh` cycle. `ps aux | grep worker.ts` revealed a **second `node ... worker.ts` process started May 29** still alive, intercepting jobs in parallel with the freshly-restarted one.
**What happened:** `./scripts/dev-up.sh --stop` (line 821-832 in `apps/api/src/worker.ts`) closes the BullMQ Workers + Redis connection cleanly, but the parent `pnpm --filter @declutrmail/api worker` shell wrapper doesn't always propagate SIGTERM to the actual `node --import @swc-node/register/esm-register src/worker.ts` child. The May 29 worker's TS module graph was loaded BEFORE ADR-0019 added the Delete verb to the Action Registry (ACTION_VERBS, ACTION_REGISTRY, PIPELINE_COMPLETE_VERBS, ActionLabelAppliedPayloadSchema). `labelChangeForVerb('delete')` on that old graph threw `ValidationError('unknown action verb delete')` — a message that literally no longer exists in current source, which made the bug nearly impossible to grep into. BullMQ workers compete for jobs from the same queue, so any single delete attempt had a ~50/50 chance of hitting either consumer — the only fix was to kill the stale PID.
**Correct approach:** On every dev-up restart, verify there's exactly ONE `worker.ts` process per queue. `dev-up.sh` should add a sanity check before starting the new worker: `pgrep -f "worker\\.ts" | xargs -r kill -9` (or scope by cwd). Alternative: a `worker-startup` log line that includes a build-time hash / commit short SHA so an old process is visibly identified by its hash differing from the running source tree.
**Rule:** Before debugging a "code-doesn't-match-behavior" mystery in a dev worker, ALWAYS check `ps aux | grep worker\.ts` for multiple instances. swc-node uses in-memory module compilation; a process that was started before a code change keeps the OLD source graph until it exits, no matter how many file edits happen. The grep-the-codebase-for-the-error-message reflex fails when the error originates from a process holding a version of the source that no longer exists on disk.
**Enforcement update:**
1. `scripts/dev-up.sh` — add a pre-start `pkill -f "apps/api/src/worker\\.ts" || true` sweep gated on the project-root cwd so concurrent dev-ups in OTHER repos aren't affected.
2. Worker boot — log a structured `worker.boot { gitSha, startedAt, pid }` line; a quick `tail` against the log file shows whether the running process matches `git rev-parse HEAD`.
3. CLAUDE.md §8 "Smoke before merge" — add a one-line note: "When smoking a worker change, verify exactly one `worker.ts` process is running before issuing the test action."

## 2026-06-05 — BullMQ `queue.add` inside `db.transaction(...)` callback publishes job BEFORE PG commits

**PR:** (this branch, fixed pre-merge — `04c8546`)
**Caught by:** architecture-guardian critic pass — [BLOCKING]
**What happened:** Closing the `gmail-webhook.service.ts:151` TODO, the enqueue was added inside the existing `this.db.transaction(async (tx) => { ... await ensureIncrementalSyncJob(...) ... })` callback. The inline comment claimed "the enqueue happens AFTER the tx body but BEFORE the tx commits" — wrong. Awaiting `queue.add` inside the Drizzle tx callback publishes the BullMQ job (durable in Redis the instant `add()` resolves) before the transaction's resolved value gets committed. A commit failure between `add()` returning and the COMMIT statement landing would leave the job durable while the dedup row + cursor advance get rolled back — the worker would then run against the OLD `last_history_id`, silently regressing history.
**Correct approach:** External side effects that the transactional store can't roll back (BullMQ, HTTP calls, emails) MUST run AFTER `await db.transaction(...)` resolves. Capture the values needed for the side effect inside the tx, return them from the callback, dispatch the side effect from the post-`await` continuation. `SyncModule.connect` (initial-sync enqueue path) already follows this contract.
**Rule:** When ANY of {BullMQ, Stripe, Sentry capture, outbound HTTP, email} appears in a code path that also opens a PG transaction, place the side effect OUTSIDE `db.transaction(...)`. The discriminated outcome union is the carrier — keep the tx body pure DB writes, dispatch external effects in the continuation. Mirror: never trust an inline comment that says "AFTER the tx body" — verify by reading the closure structure.
**Enforcement update:** architecture-guardian agent prompt — add an explicit check: "external side effects (queue.add, Stripe, HTTP, email) inside a `db.transaction` callback = BLOCKING". MISTAKES.md log + the two new tests in `gmail-webhook.service.spec.ts` (`enqueue happens AFTER the tx commits — observable ordering` + `enqueue failure does NOT roll back the tx`) document the invariant by example.

## 2026-05-27 — Raw `sql\`\`` template interpolation of a JS `Date` failed Bind on postgres-js@3.4.9 / Node v24

**PR:** [#117](https://github.com/CT2689-Tech/DeclutrMail/pull/117) — `fix(workers): serialise Date params in raw sql templates (D86)`
**Caught by:** founder (manual `dev-populate` run against real Postgres
surfaced `followup.mailbox_failed` for every mailbox; CI was green
because the test driver doesn't reproduce the bug).
**What happened:** [packages/workers/src/followup-check.worker.ts:246](packages/workers/src/followup-check.worker.ts:246)
interpolated `lookbackCutoff` (a `Date`) directly into a `sql\`\`` template:
```ts
AND internal_date > ${lookbackCutoff}
```
On the production driver (`postgres@3.4.9`, Node v24) Bind tried
`Buffer.byteLength(Date)` and threw `ERR_INVALID_ARG_TYPE`. The
per-mailbox try/catch swallowed it into a structured
`followup.mailbox_failed` log, so the whole sweep ran to completion
reporting `mailboxesFailed: N`, `awaitingUpserted: 0` — silently empty.
**Why CI didn't catch it:** the followup-check vitest suite uses
[PGlite](packages/workers/src/followup-check.worker.test.ts:4) as the
test driver. PGlite serialises a JS `Date` to a timestamp parameter
without complaint, so the fixed and broken code both passed all 10
existing integration tests. The bug only manifests against the real
postgres-js bind path.
**Correct approach:** Convert dates explicitly before passing them
through raw `sql\`\`` template literals — `${cutoff.toISOString()}`. The
ISO-8601 string casts losslessly into `timestamptz` and is unambiguous
across drivers. Drizzle's typed comparators (`gte()`, `lt()`, etc.)
auto-serialise, so a builder-style rewrite is an alternative; the raw
template stays whenever the SQL needs DISTINCT ON / CTEs that the
builder can't express ergonomically.
**Rule:** In any raw `sql\`\`` template (workers OR services), do NOT
interpolate `Date` / `BigInt` / typed wrapper values directly. Convert
to the corresponding canonical string form (`.toISOString()` for dates,
`.toString()` for bigints) before interpolation, OR switch to the
Drizzle typed comparator if the SQL allows it.
**Enforcement update:**
- 1-line fix shipped + explanatory comment at the call site naming the
  driver version and node version so the next developer doesn't have to
  rediscover the trap.
- Until D182 (testcontainers) lands, the regression isn't catchable in
  CI. Once we have a `@testcontainers/postgresql` fixture, every raw
  template in workers / services should run through it; until then,
  the only safety net is reviewer eyeballs + this rule.
- Add `silent-failure-hunter` prompt rule: flag any per-iteration
  try/catch that only logs structured + swallows when the loop drives
  externally-observable side effects (the followup sweep silently
  reported empty for every mailbox).

## 2026-05-27 — `testTimeout: 30s` set but `hookTimeout` left at default 10s — PGlite 0.4 bump tipped CI red

**PR:** [#97](https://github.com/CT2689-Tech/DeclutrMail/pull/97)
**Caught by:** CI on rebased dependabot minor+patch group bump
(consistent failure on `apps/api` and `packages/workers`:
`Hook timed out in 10000ms` inside `beforeEach` migration replay).
**What happened:** The 2026-05-26 fix to give `packages/workers` a
`vitest.config.ts` raised `testTimeout` to 30s but did NOT also
raise `hookTimeout`. Vitest's `hookTimeout` defaults to 10s
independently of `testTimeout`. PGlite 0.4 (bumped from 0.2 in the
deps group) made `beforeEach` migration replay slow enough on CI
runners to blow the default 10s `beforeEach` budget while still
fitting under the 30s `it()` budget — invisible until the bump
landed. `apps/api` had no vitest config at all, so it inherited
both defaults.
**Correct approach:** Raise `hookTimeout` to match `testTimeout`
whenever the package uses PGlite + migration-driven `beforeEach`.
Both knobs travel together, not independently. The "copy the
config profile from `packages/db`" rule should mean ALL four
PGlite knobs (`testTimeout`, `hookTimeout`, plus the `include`
pattern + the comment explaining why), not just the one that
caught the last regression.
**Rule:** Any package with PGlite + migration-driven integration
tests MUST set BOTH `testTimeout: 30_000` AND `hookTimeout: 30_000`
in its `vitest.config.ts`. Patch the 2026-05-26 entry's rule the
same way.
**Enforcement update:** none yet. If this recurs (third PGlite
package shipped with wrong defaults), promote to a lint rule that
scans for `pglite` imports + asserts both timeout knobs are set.

## 2026-05-26 — `packages/workers` had no vitest config → CI default 5s timeout flaked PGlite tests

**PR:** [#98](https://github.com/CT2689-Tech/DeclutrMail/pull/98)
**Caught by:** CI on main (consistently red on `OutboxDispatcherWorker
> LISTEN handler wakes a tick before the polling interval fires`,
then on `AFTER INSERT trigger emits pg_notify on the outbox_inserted
channel` once the first was patched — same root cause, different
victim test)
**What happened:** `packages/workers` shipped without a
`vitest.config.ts`, so its tests ran under vitest's default
`testTimeout`. Every integration test in that package spins up PGlite
+ applies every migration per `it()` (~3-10s of fixture work on CI
before the test logic even starts). Sister package `packages/db` —
same fixture profile — already set `testTimeout: 30_000`; workers
just never got the same treatment. First attempt fixed only the one
failing test (`it(..., 15_000)`) which made the next-longest test in
the file the new flake. Second attempt fixed the package globally
via config.
**Correct approach:** When adding a package that runs PGlite +
migrations per test, copy the vitest config profile from `packages/db`
(`testTimeout: 30_000`) at the same time. Don't fix flakes test-by-
test when the timeout budget is package-wide.
**Rule:** Any package with PGlite + migration-driven integration
tests MUST have a `vitest.config.ts` with `testTimeout` ≥ 30_000. New
packages of this shape MUST be onboarded with the config in the same
PR as the first integration test.
**Enforcement update:** none yet. Candidates if it recurs: a lint rule
or CI check that fails when a package contains `*.test.ts` importing
`@electric-sql/pglite` but no `vitest.config.ts` with `testTimeout`
set. Hold for now — single recurrence, easy to spot in review.

## 2026-05-26 — Five reviewable bugs caught by Codex across the Variant D + Autopilot stacks

**PRs:** #64 (db), #65 (workers), #77 (api adapter), #78 (events),
#82 (web — gate), #83 (web — settings)
**Caught by:** Codex review (post-push, pre-merge)
**What happened:** Five distinct bugs, all caught on the same review
sweep. Notable that they share an underlying pattern: **partial
application of new logic** — a rule was introduced at one site but
not extended to the parallel sites that exercise the same data path.

  1. PR #82 — added `intentOf()` confidence gate in `groupByIntent`
     but left two other call sites (`onStartReview()`, `computeTotals`)
     filtering on the raw `lastReview.verdict`. The Cleanup bucket
     suppressed low-confidence verdicts; the hero CTA + KPI cells
     did not.

  2. PR #83 — `useSenders()` is an infinite query. The new screen
     `flatMap`'d only the first page. API clamps `limit` to 100 →
     any protected sender past row 100 was invisible on a screen
     whose contract is "every standing policy lives here".

  3. PR #78 — `EVENT_SCHEMAS` comment claimed `satisfies
     Record<EventTopic, ZodSchema>` exhaustiveness, but the actual
     declaration was only `as const`. A new topic in `TOPICS`
     without a schema entry would compile clean and fail only at
     the runtime parity test.

  4. PR #65 — `newsletter_graveyard` (`lastSeenDaysAgo > 90`) and
     `long_dormant_unsubscribe` (`> 180`) had overlapping windows
     w/ identical `actionKind: 'unsubscribe'`. A sender at 200d w/
     low read rate fired BOTH presets → two unsubscribe-match rows
     for a single sweep.

  5. PR #64/#65 — match insert was plain `INSERT VALUES (...)` with
     no dedup. Re-running the worker created N duplicate pending
     suggestions for the same `(rule, sender)` until the user
     resolved one — flooding the suggestion UI.

**Correct approach (per finding):**
  1. Reuse `intentOf(s) === 'cleanup'` everywhere; never re-derive
     "is this Cleanup?" from raw fields after a centralizing helper
     exists.
  2. For "list every X" screens, auto-paginate via `useEffect` →
     `fetchNextPage` loop with a hard cap, OR add a dedicated
     filtered endpoint.
  3. `as const satisfies T` is the canonical exhaustiveness pattern;
     neither half alone suffices.
  4. Disjoint windows by construction; never two unsubscribe-class
     presets overlap on the same predicate axis.
  5. Pair every match-insert with a DB-level partial unique idx +
     `onConflictDoNothing({ target, where })` mirroring the
     predicate.

**Rule:** When a new helper / gate / index centralizes a decision,
grep ALL call sites of the parallel raw-field check and migrate
them in the same PR. Centralization without migration is a worse
state than no centralization — it creates a quiet two-truths bug.

**Enforcement update:** None directly. Indirect: continue running
Codex review after every push during the multi-PR-stack workflow —
the failures here were detectable by a reviewer that grep'd for
parallel use of the gated field, which the existing review prompt
already encourages.

## 2026-05-22 — InitialSyncWorker could not sync a mailbox larger than ~3,000 messages
**PR:** #17 (`feat/d157-initial-sync-worker`) shipped the bug; fixed in `feat/d005-sync-quota-hardening`
**Caught by:** manual test — connecting a real 20K-message Gmail account
**What happened:** PR-C's `InitialSyncWorker` fetched message metadata
behind a concurrency cap (`FETCH_CONCURRENCY=20`) but NO rate limiter.
§5 says "throttle per D5" — a concurrency cap is not a rate limit. A
20K-message backfill burst past Gmail's per-user quota (15,000 units /
user / minute; `messages.get` = 5 units → 3,000 messages/min) and got
403 "Quota exceeded" at exactly 3,000 messages. Worse: (1) the 403 was
classified as `TransientError` because only 429 mapped to
`RateLimitError`; (2) the worker had no checkpointing, so each of the 5
retries restarted from message 0, re-hit the quota, and dead-lettered.
Net: any mailbox over ~3,000 messages could never sync. The two small
test accounts (327, 140 messages) passed only because they sat under
the ceiling — small-sample testing hid it.
**Correct approach:** A real rate limiter pacing Gmail calls under the
per-user quota; classify Gmail 403-quota AND 429 as `RateLimitError`;
make the sync resumable (`mail_messages` IS the checkpoint — skip
already-stored ids on retry) so an interruption never restarts from 0.
All three shipped in the hardening PR.
**Rule:** A "throttle" requirement means a rate limiter, not a
concurrency cap. Any worker calling a quota-metered API MUST (a) pace
under the documented quota and (b) be resumable — never restart a
multi-minute job from zero. Test workers against data above the
provider's per-window limit, not just small samples.
**Enforcement update:** none yet — candidates: an `architecture-guardian`
check that a quota-metered worker declares a limiter, and a load-shaped
worker test. Logged for distillation if the pattern recurs.

## 2026-05-21 — Presented a "new" token-encryption decision that D14 already made
**PR:** #14 (`docs/d039-senders-backend-plan`) — caught before merge
**Caught by:** self — a plan grep for `D14` while finalizing the config file,
after the founder had already OK'd the wrong option.
**What happened:** PR-B needs OAuth-token encryption. I framed it to the
founder as an open choice — "app-level AES-256-GCM vs Cloud KMS" — and
recommended AES-256-GCM. The founder OK'd it. But **D14 is a locked
decision** that already mandates Google Cloud KMS envelope encryption,
and D14 explicitly argues against an env-var-class key. I had written
the choice into `senders-backend-plan.md` §4 and `FOUNDER-FOLLOWUPS.md`
as "RESOLVED — AES-256-GCM" before checking the plan. No code shipped;
caught while writing `.env.example`. Surfaced as plan-drift; founder
confirmed D14 stands; all docs corrected.
**Correct approach:** Before presenting ANY decision as open, grep the
plan for an existing D-decision on that topic. CLAUDE.md §1.1 says
"First, check the plan" — a token-encryption decision is exactly the
kind of thing the plan already settles. Had I grepped `D14` first, there
would have been no decision to present.
**Rule:** Before offering the founder a choice, `rg "encrypt|<topic>"`
the plan — if a D-decision covers it, follow it; only surface a *conflict*
if the codebase reality diverges. Never present a settled topic as open.
**Enforcement update:** none code-level — this is a §1.1 discipline miss.
Promote to CLAUDE.md §9 ("What to do if unsure" → step 1 already says
search the plan; reinforce it covers *decisions I'm about to present*,
not only blockers) if it recurs.

## 2026-05-20 — Visual pass shipped a desktop-only layout + a search dead-end
**PR:** #TBD — `feat/d038-senders-screen` (visual-optimization pass)
**Caught by:** Codex adversarial review + a browser check at 401 px
**What happened:** Two regressions in the visual-optimization pass.
(1) `sender-list-row.tsx` replaced an `auto` action column with a hard
`156px`. Row alignment was fixed, but the row's minimum width now
exceeds a phone viewport, and the parent scroll area clips overflow, so
row actions become unreachable. A browser check at 401 px showed the
whole shell non-responsive — the 220 px sidebar never collapses and
content is crushed to ~190 px. (2) The new `SenderSearch` typeahead drew
suggestions from the full sender list while the table stayed filtered by
category/facet; picking a suggestion for a filtered-out sender produced
an empty table that claimed "no match".
**Correct approach:** Build responsive from the start — mobile drawer in
`AppShell`, fluid grids, a row layout that reflows. Search stays global,
but picking a suggestion clears active filters so the result is always
visible.
**Rule:** Check any new screen/shell at a phone width before calling it
done. A fixed-width column is a layout regression unless the row can
still reflow under it.
**Enforcement update:** none — fixed in the follow-up pass (AppShell
drawer, auto-fit grids, responsive row, clear-filters-on-pick).

## 2026-05-20 — Review-session apply used if/else-if, dropped decisions
**PR:** #TBD — `feat/d038-senders-screen` (fixed in commit 215e9a0)
**Caught by:** gate review — typescript-reviewer + silent-failure-hunter
**What happened:** `applyReview` in `senders-screen.tsx` branched the
three verb buckets (Unsubscribe / Later / Protect) with `if … else if
… else if`. A mixed review session — some senders Unsubscribe, others
Later — fired only the first non-empty bucket and silently dropped the
rest. A trailing toast still announced "Also moved N to Later", so the
UI claimed work that never ran. The loose `string` typing of decision
values (no union) is what let producer and consumer drift without a
compile error.
**Correct approach:** Independent `if`s (or a loop over buckets) so every
bucket applies; type decision values as a closed union.
**Rule:** Branches that look mutually exclusive but are independent must
be independent `if`s, not an `if/else-if` chain. Model closed value sets
as union types so producer/consumer mismatches fail `tsc`.
**Enforcement update:** none — fixed in-PR (independent buckets +
`DecisionId` union). Behavioral; promote to CLAUDE.md §1 if it recurs.

## 2026-05-20 — Rename recon used an extension-filtered grep, missed config files
**PR:** #TBD — `chore/d173-rename-ui-to-shared`
**Caught by:** broad verification grep (later in the same session)
**What happened:** Scoping the `packages/ui` → `packages/shared` rename, the
recon `grep` used `--include=*.json --include=*.ts --include=*.tsx
--include=*.mjs --include=*.js --include=*.md --include=*.yaml`. It excluded
`.sh` and (by extension-name) `.yml`. The plan therefore claimed "no source
imports to update" and scoped the change to one agent file. The post-rename
verification grep (no filter) then found four more path refs: `subagent-gate.yml`
(`design` paths-filter), `require-preview-before-mutation.sh` (functional scope
glob), `check-microcopy.sh` (comment). The `subagent-gate.yml` one would have
silently disabled the design-system-agent gate on PR 3 — the opposite of the
PR's purpose.
**Correct approach:** Recon for a rename/move must grep the whole tree with no
`--include` filter. CI workflow YAML, shell hooks, and agent configs all
reference paths and are invisible to source-only greps.
**Rule:** When renaming or moving any path/package, grep unfiltered first —
`grep -rn '<oldpath>' --exclude-dir=node_modules --exclude-dir=.git .` — before
scoping the change. Never scope a rename off an extension-filtered grep.
**Enforcement update:** none — behavioral rule; promote to CLAUDE.md §1.3 if a
path-rename recon miss recurs.

## 2026-05-20 — packages/ui scaffolded against D173
**PR:** #TBD — `chore/d173-rename-ui-to-shared`
**Caught by:** session review (PR 3 prep)
**What happened:** PR 1 scaffolded a `packages/ui` workspace package
(`@declutrmail/ui`). D173 explicitly rejects it: *"packages/ui — only one
consumer (apps/web) at launch, doesn't earn package status."* The plan's
canonical shared package is `packages/shared` (D173, D198, D199, D210, D220 —
hooks, components, tokens, copy, types, Zod schemas).
**Correct approach:** Scaffold `packages/shared` per D173, not `packages/ui`.
**Rule:** Before creating a workspace package, confirm its name against the
plan's structure decisions (D173).
**Enforcement update:** none — one-off scaffold error; renamed to
`packages/shared` in this PR.

## 2026-05-23 — Drizzle correlated subquery silently degenerated to tautology
**PR:** #43 — `feat(senders): senders read module + 5 endpoints (D39, D40, D44, D45, D46, D204)`
**Caught by:** founder (manual Senders screen inspection — every row showed identical `monthlyVolume: 10`, `readRate: 0`)
**What happened:** `SendersReadService.listSenders` / `getSenderDetail`
([apps/api/src/senders/senders.read-service.ts:107-122](apps/api/src/senders/senders.read-service.ts:107),
[:196-211](apps/api/src/senders/senders.read-service.ts:196)) built a correlated
subquery against `sender_timeseries` to fill the latest-month `volume` and
`read_count`. The `sql` template interpolated `Column` objects on BOTH sides of
the join predicate (`${senderTimeseries.mailboxAccountId} = ${senders.mailboxAccountId}`).
Drizzle's `sql` template emits **unqualified** column names for `Column` values,
so the rendered SQL became `WHERE "mailbox_account_id" = "mailbox_account_id" AND
"sender_key" = "sender_key"` — both names resolved to the inner
`sender_timeseries` scope (PG scope rule), making the predicate a tautology. The
subquery then returned the same single row (whichever the planner picked first)
for every sender — and because the tautology eliminated the mailbox predicate
entirely, that row could come from ANY mailbox in the table. Tests at
[senders.read-service.spec.ts:268](apps/api/src/senders/senders.read-service.spec.ts:268)
passed because they seeded ONE sender with ONE matching timeseries row — the
tautology coincidentally returned the right row.
**Severity:** Cross-tenant data exposure of integer rollup columns
(`volume`, `read_count`). No body content, headers, snippets, or PII fields
were involved — D7/D228 invariants remained intact — but the mailbox
boundary for `sender_timeseries` was effectively bypassed by every list /
detail response until the fix landed. The post-fix specs include explicit
cross-mailbox `sender_key` collision regression tests that fail loudly if
the boundary is dropped again.
**Correct approach:** Qualify outer-scope identifiers explicitly in `sql`
templates — prefer `sql.identifier(getTableName(table))` over a hardcoded
string so a future schema rename surfaces in one helper call rather than
silently re-introducing the tautology. For correlated subqueries Drizzle
does not auto-qualify; the developer must. Tests for any correlated read
MUST seed ≥2 senders, each with ≥2 distinct timeseries rows, AND a
cross-mailbox `sender_key` collision case, and assert that each sender /
mailbox gets its OWN row.
**Rule:** Drizzle `sql` templates referencing an OUTER table inside a
subquery must use `sql.identifier(getTableName(table))` (or
`sql.raw('table.column')` if the table is irrefutably stable), never a
bare `${table.column}` interpolation. Any read-service spec that
exercises a correlated subquery must seed multi-sender + multi-timeseries
fixtures AND a cross-mailbox collision case for tenant-boundary coverage.
**Enforcement update:** Add a `silent-failure-hunter` / `architecture-guardian`
prompt rule for "correlated subquery without qualified outer identifier";
add a checklist line to the schema-migration-reviewer for read-service
specs ("seeds ≥2 entities for cross-row queries AND a cross-mailbox
collision case").

## 2026-05-26 — ARCH-DRIFT: webhooks module writes directly to sync feature's table (D204)
**PR:** N/A (post-merge audit) — `git log d4d996a..HEAD` includes the relevant commits in PR #38 (sync gate) carried forward; the cross-feature write specifically lives in `apps/api/src/webhooks/gmail-webhook.service.ts` shipped earlier and was not refactored when the sync feature module was added.
**Caught by:** architecture-drift-oracle (scheduled task, 2026-05-26 sweep) — replayed architecture-guardian Check C (read-only services + cross-feature events, D204)
**What happened:** `GmailWebhookService.processVerifiedPush` ([apps/api/src/webhooks/gmail-webhook.service.ts:152-159](apps/api/src/webhooks/gmail-webhook.service.ts:152)) issues a direct `tx.update(providerSyncState).set({ lastHistoryId, historyIdUpdatedAt, updatedAt })` against the **sync** feature's table from the **webhooks** module. The table is owned by `SyncModule`; D204 requires cross-feature writes to go through the owning module's exported facade or an outbox event. The cross-module dependency is invisible at the NestJS module-graph level — `WebhooksModule` does not import `SyncModule` — so the coupling is purely schema-shared and the `architecture-guardian` PR-time gate did not see it as a cross-feature write because both files reference `providerSyncState` from `packages/db/src/schema`.
**Correct approach:** Either (a) inject `SyncService` into `GmailWebhookService` and expose an `advanceHistoryId(mailboxAccountId, incomingHistoryId): { kind: 'advanced'|'stale'|'uninitialized', ... }` method that owns the `SELECT ... FOR UPDATE` + `UPDATE` transaction; OR (b) emit a `webhook.history_advanced` outbox event the sync feature consumes. Option (a) is simpler given the transactional contract; option (b) decouples webhook latency from sync persistence and matches the outbox pattern already used elsewhere.
**Rule:** Cross-feature writes must traverse the owning module's facade (`*Service` exported from its module) or an outbox event. A direct Drizzle write to another feature's schema from inside a different module is a D204 violation, even if both files import the same `packages/db` symbol.
**Enforcement update:** Extend `architecture-guardian` Check C to flag "write to `<table>` from a module that does not import the `<table>`'s owning service module" — today it only catches explicit cross-package imports, not shared-schema writes that bypass the module graph entirely. Until the agent prompt is updated, add a checklist line to webhook-security-auditor's review template ("does this handler write to any non-webhooks table? If yes, it must go through the owner's service.").

## 2026-05-26 — ARCH-DRIFT: sync status endpoint ships without `{ data, meta }` envelope (D202)
**PR:** N/A (post-merge audit) — landed in PR #38 `feat(sync): sync status contract + read endpoint (D224)`, commit a64dac2
**Caught by:** architecture-drift-oracle (scheduled task, 2026-05-26 sweep) — replayed architecture-guardian Check F (API envelope + pagination, D202)
**What happened:** `SyncController.getStatus` ([apps/api/src/sync/sync.controller.ts:49](apps/api/src/sync/sync.controller.ts:49)) returns the bare `SyncStatus` object instead of the D202-mandated `{ data, meta }` envelope. The drift is self-acknowledged at [sync.controller.ts:33](apps/api/src/sync/sync.controller.ts:33) (`TODO(D202): wrap the response in the { data, meta } envelope when the shared envelope helper lands`) — the route shipped knowingly non-compliant on the rationale that the envelope is a "non-breaking outer wrapper". The endpoint is polled every 3s by `useSyncStatus()` during onboarding (D6, D109), so the contract change becomes higher-impact the longer it sits.
**Correct approach:** The shared `ok()` envelope helper exists and is already used by autopilot/briefs/followups/senders. Sync should adopt it now rather than waiting for "the helper to land". A TODO is not a complete PR (CLAUDE.md §10 "no fake completion") when the missing piece is a D-decision requirement.
**Rule:** Every new HTTP response under `/v1/**` MUST use the `ok()` envelope (or pagination helper) on day one — no `TODO(D202)` shipped to main. If the contract can't be honored, the route is not ready to merge.
**Enforcement update:** `architecture-guardian` Check F should hard-fail (not warn) on any `@Controller('v1/...')` handler whose return type is not wrapped — the gate currently allowed PR #38 through. Until that lands, add a PR-template checklist item: "All new `/v1/*` responses use `ok()` / `paginated()` — TODO(D202) is not acceptable."

## 2026-05-26 — ARCH-DRIFT: pattern — 2 blocking findings this week — gate enforcement may be insufficient
**PR:** N/A — summary of the two entries above
**Caught by:** architecture-drift-oracle (scheduled task, 2026-05-26 sweep)
**What happened:** Two independent D204/D202 violations landed on `main` in the trailing 7-day window despite the `architecture-guardian` PR-time gate. The pattern: the gate catches *intra-PR* structure (correct imports, correct provider scoping) but not *cross-PR drift* where one PR's table becomes another module's silent write target, or where an explicit `TODO(D-number)` is allowed to ship.
**Correct approach:** Two reinforcements: (a) `architecture-guardian` should treat any `TODO(D###)` in a touched file as a blocking finding unless the touched D-row is explicitly outside this PR's scope; (b) `architecture-guardian` should run a "schema ownership" check — for every Drizzle write in the diff, the writing module must either own the schema file OR import the owning module's service.
**Rule:** When the same gate misses 2+ findings in one week, the gate's coverage is the bug, not the authors. File a `chore/distill-architecture-guardian-D204-D202` PR to tighten the agent prompt before the next sweep.
**Enforcement update:** Open a follow-up to extend `architecture-guardian.md` checks C + F per the two entries above; until then the weekly oracle is the only safety net.

## 2026-05-27 — IMPL-LOG-DRIFT: 11 PRs shipped with title D-refs missing from `Closes` lines; 21 ⬜ rows left un-flipped
**PR:** #44, #47, #48, #50, #52, #77, #102, #103, #105, #107, #108, #109 (audit) — patch in `chore/distill-closes-trailers`
**Caught by:** impl-log-drift-oracle (scheduled task, 2026-05-27 sweep)
**What happened:** Across the trailing 7-day window, 11 merged PRs cited multiple D-numbers in the PR title (e.g. `feat(api): foo (D99, D104, D105, D234)`) but the body carried only one `Closes D###` line — usually the lowest-numbered D. `pr-merged.yml` flips only Ds it finds in `Closes` lines, so 21 ⬜ rows that had actually shipped (D12, D31, D32, D33, D34, D36, D62, D63, D67, D70, D85, D86, D101, D102, D104, D105, D196, D197, D208, D226, D234) remained marked as Not-started. `IMPLEMENTATION-LOG.md` decoupled from the merge history — the artifact that's supposed to be the source of truth for plan progress lied about ~20% of the plan's recent state. Two failure modes overlap: (a) author discipline — title and body are not kept in lockstep, (b) workflow regex — `[^|]+` group in the flip pattern silently fails on D-row titles with embedded `|` (D12's `sha256("v1|" + …)` was the trigger; PR #48 carried the correct `Closes D12` and the flip still no-op'd).
**Correct approach:** Title-cited D-numbers and body `Closes` lines must always be the same set. Either tighten the author side (a PR-open gate rejecting unmatched sets) or loosen the flipper (harvest D-refs from the title in addition to the body, with a documented exemption for `chore/learnings` style PRs that intentionally cite a D without shipping it — e.g. PR #42 said `Relates to D182` deliberately). The workflow regex bug is independent and must be fixed regardless.
**Rule:** A PR title D-ref is a contract — the body MUST carry a matching `Closes D###` line for every D in the title, unless the body explicitly says `Relates to D###` (the only documented non-flipping form). The flip workflow's row-match regex MUST tolerate `|` inside titles (use non-greedy `.+?` anchored on the trailing ` | ⬜ |` token, not `[^|]+`).
**Enforcement update:** Three follow-ups filed in `FOUNDER-FOLLOWUPS.md` (2026-05-27): (1) the per-PR fix matrix is now resolved by the `chore/distill-closes-trailers` PR that this entry ships with; (2) a process-break entry asks the founder to pick "tighten the PR-open gate" vs "loosen the flipper"; (3) a separate entry tracks the `pr-merged.yml` `[^|]+` regex bug. Until the founder picks an enforcement option, the weekly oracle is the only safety net catching this drift class.

## 2026-05-28 — D204: mailboxes service joined sync's table directly (caught pre-merge)
**PR:** feat/d115-secondary-mailbox-gate (pre-merge; not shipped)
**Caught by:** architecture-guardian (GATE, local run before commit)
**What happened:** To put a per-mailbox "Syncing…→Ready" badge in the account switcher (D116), the first cut added `readiness` to `MailboxSummary` and LEFT JOINed `provider_sync_state` inside `MailboxAccountsService.listByWorkspace`. That table is owned by the sync feature — every other consumer (webhook cursor advance, `getStatus`) routes through `SyncService`. Doing it via DI would have created a Sync↔Mailboxes circular module dep, which is the boundary signalling that readiness is a sync-feature read to compose at a higher layer.
**Correct approach:** Add a batch facade `SyncService.getReadinessByMailbox(ids)` (sync owns the read), and compose `readiness` onto a `MailboxView` at the **controller seam** (`auth.controller.me`), where two independently-owned facades are already orchestrated. The mailboxes service stays pure.
**Rule:** A feature service must never read another feature's table — even a denormalized read for a list response. Expose it via the owning module's exported facade and compose at the controller. If "doing it right" would need a circular module import, that's the boundary telling you the field belongs to the other feature.
**Enforcement update:** Reinforces the existing `architecture-guardian` Check C "schema ownership" follow-up (MISTAKES 2026-05-26). This is the 3rd D204 boundary data point — the distillation trigger (recurrence ≥3) is met; a `chore/distill-architecture-guardian-D204` candidate is warranted. The gate DID catch this one pre-merge (read-side), so the PR-time net works for reads; the gap remains cross-PR drift.

## 2026-05-28 — Mailbox switch/disconnect didn't update UI until hard refresh (+ false smoke)
**PR:** feat/d115 multi-mailbox (fix on chore/distill-flow-completeness, commit fd99b3a)
**Caught by:** founder (manual), AFTER I claimed the flow was "smoked" and working
**What happened:** `resetMailboxScopedCache` used `qc.clear()` then `invalidateQueries({ queryKey: ME_QUERY_KEY })`. `clear()` empties the cache but does NOT make MOUNTED observers (AuthProvider `me`, senders list) refetch/re-render — they hold last data until a remount. And invalidating a specific key AFTER `clear()` is a no-op (the query was just removed). So switching/disconnecting a mailbox only took effect on a hard refresh. Worse: I reported it "smoked + working" the prior turn — but my smoke had done a full re-auth (hard page nav) between the switch and the check, so I verified a hard-load, not the live SPA switch. I mistook a navigation for an in-place update.
**Correct approach:** `qc.invalidateQueries()` with NO filter — marks all queries stale and refetches active (mounted) observers immediately (default `refetchType: 'active'`), so `me` + feature lists update live. Verified properly via the D206 dev-login: switch chintan↔crypt with NO navigation, breadcrumb + data changed.
**Rule:** (1) `clear()` ≠ "refetch everything" — use `invalidateQueries()` to update mounted observers; `clear()` is for logout-style resets. (2) A flow smoke MUST exercise the SPA transition itself — no page reload/navigation between the action and the assertion, or you're testing a hard load, not the feature. URL must not change.
**Enforcement update:** `flow-completeness-auditor` already flags scope-change mutations + "needs live smoke"; add "verify with NO navigation between action and assertion" to its smoke guidance. The clear-vs-invalidate gotcha is now in this entry; promote to CLAUDE.md §8 if it recurs.

## 2026-05-28 — Senders list: VIP-only bulk-actionable + `generatedBy` wire drift (shipped green)
**PR:** claude/sweet-cannon-bryBs (senders production-hardening; cites D39, D42, D43)
**Caught by:** manual two-mailbox smoke (live API + seeded data) for the wire-drift + dead-data gaps; `design-system-agent` (GATE) for the VIP-only gap introduced mid-fix.
**What happened:** Three "passed every structural gate, wrong in production" defects on the Senders read surface, plus one self-inflicted during the fix:
1. **`generatedBy` wire drift** — `DecisionHistoryRowDto.generatedBy` was typed `'llm' | 'template'` while the BE/DB enum is `'llm_haiku' | 'template'`. `GENERATED_BY_TO_SOURCE['llm_haiku']` was therefore `undefined`, so the Sender Detail decision-timeline rendered a blank source label for EVERY LLM-generated decision (the common case). Unit tests passed because they were written against the wrong `'llm'` literal — the tests encoded the bug.
2. **Dead protection surface** — the list endpoint never sent protection flags, so the row "Protected" chip, the "Protected" KPI (always 0), and the "Protect" intent bucket (always empty) were dead; VIPs/protected senders were mis-bucketed as Cleanup/People.
3. **Bypassed confidence gate** — the list `lastReview` carried no `confidence`, so `intentOf`'s gate defaulted to 1.0 and surfaced low-confidence unsubscribe verdicts as recommendations (contradicts the "don't pressure on unsure" product rule).
4. **VIP-only bulk-actionable (self-inflicted)** — when surfacing protection, I OR-ed `isVip` into the KPI + intent bucket but left the row chip/CTA + `canArchive/canLater/canUnsubscribe` reading `s.protected` alone. A VIP-only sender (`isVip:true, isProtected:false` — the flags are independent on the wire, D42/D43) was counted/bucketed as protected yet still rendered destructive verbs. The seed + fixtures masked it (their VIPs were also `isProtected`).
**Correct approach:** Surface the already-stored data on the list endpoint (protection flags + decision confidence — privacy-safe, no new storage); fix the wire enum to `'llm_haiku'`; and route EVERY "shielded from destructive action" surface (row chip, row CTA, grid-card buttons, bulk `canArchive/canLater/canUnsubscribe`, KPI, intent bucket) through ONE predicate `isStandingProtected(s) = protected || isVip` so they cannot disagree.
**Rule:** (1) A FE wire enum literal MUST match the BE enum byte-for-byte; write at least one test against the REAL BE value, never only the literal you typed. (2) When a model field gains a new flag that gates a destructive action, find ALL gates for that action and route them through a single shared predicate in the same PR — a partial roll-out where surfaces disagree is the bug. (3) Independent boolean flags (VIP vs Protect) must be seeded/fixtured independently, or the divergent case never gets exercised.
**Enforcement update:** Added `apps/web/src/features/senders/api/adapters.test.ts` (asserts `llm_haiku → 'Triage'` and that a VIP-only wire row is non-archivable + buckets to Protect); decoupled `fixtureProtectionFlags` so `isVip` and `isProtected` are independent. Candidate for `type-design-analyzer` / a wire-contract test to assert FE enum literals are a superset of the BE enum at build time — promote to a check if this drift class recurs.

## 2026-05-29 — Hand-recomputed `atlas.sum`, corrupting 15 valid hashes
**PR:** #131 (feat/d168-error-envelope-security-log)
**Caught by:** CI `atlas migrate lint` (`checksum mismatch (atlas.sum): L3: 0001 … was edited`)
**What happened:** Adding migration 0016 with no Atlas CLI available (network-blocked), I assumed `atlas.sum`'s per-file `h1:` was `sha256(name+content)` because file 0000 matched it. It was a coincidence — 0000's raw bytes are already atlas-canonical. I concluded the sum was "stale" for 0001–0015, "fully regenerated" it from raw bytes, and even wrote that false "stale/corrected" claim into the PR body + FOUNDER-FOLLOWUPS + LEARNINGS. In reality Atlas canonicalizes SQL before hashing (not reproducible from bytes), the committed sum was valid (PR #130's atlas-lint was green; the `.sql` bytes are identical to main), and my regen corrupted 15 good hashes — burning two CI cycles.
**Correct approach:** Never hand-edit `atlas.sum`. Restore main's exact hash lines; the new migration's entry needs the real `atlas migrate hash` (run in an env with Atlas, or CI). Don't assert a diagnosis ("stale") as fact in artifacts before it's verified — I should have read the CI log first instead of inferring "checksum mismatch" from job duration.
**Rule:** (1) `atlas.sum` is Atlas-CLI-owned; if you can't run `atlas migrate hash`, leave it and flag a follow-up — recomputing from bytes corrupts valid entries. (2) Read the actual CI log before diagnosing a failure; never infer the failure class from timing. (3) Don't write a hypothesis into PR/docs as established fact.
**Enforcement update:** LEARNINGS + FOUNDER-FOLLOWUPS corrected; candidate CLAUDE.md §4 line "never hand-edit atlas.sum."

## 2026-05-30 — Cited D232 when the invariant was D35/D58
**PR:** N/A (caught in `docs/handoffs/2026-05-30-bulk-actions-architecture-codex-review.md` before any code landed)
**Caught by:** Codex review (Concerns §4: "D232 is account deletion respecting undo windows")
**What happened:** Architecture proposal repeatedly cited D232 as the authority for "atomic undo per action_job, partial undo NOT supported." D232 is actually about account deletion respecting `max(now+7d, latest_undo_expires_at)` — adjacent topic, not the atomicity invariant. Atomic undo lives in D35 (persistent undo tray) + D58 (Activity row "Undo") + the `undo_journal.reverted_at IS NULL` atomic-lock pattern in the existing schema. I leaned on D232 because it FELT proximate ("undo windows!") without re-reading what D232 actually decides.
**Correct approach:** Re-read the D-body before citing. Cite the D that decides the rule, not the D that mentions the term. When unsure, search the plan (`rg "atomic"`, `rg "partial undo"`) and read the matched bodies.
**Rule:** Citation discipline — when invoking a D-number, the D's BODY must actually decide the rule you're invoking it for. "D-number adjacency by topic" is not citation; it's pattern-matching on keywords.
**Enforcement update:** None automated (citations are judgment calls). LEARNINGS already captures the pattern. Watch for repeat occurrences in PR-review and ADR PRs; if it happens twice more, distill into CLAUDE.md §3 ("Source-of-truth precedence") as an explicit citation rule.

## 2026-06-10 — "Later" shipped green but Gmail rejects label NAMES
**PR:** feat/d226-triage-mutation-wiring (Wave 1 Track A, pre-merge)
**Caught by:** manual live smoke (CLAUDE.md §8) — every structural gate, typecheck, and 281 worker unit tests were green
**What happened:** The action manifest's `buildLabelChange` for the `later` verb emits `addLabelIds: ['DeclutrMail/Later']` — a label NAME. Gmail `messages.batchModify` accepts label IDS only, and nothing ever created the label. First real Later: `400 Invalid label: DeclutrMail/Later`. Worse, the worker classified the 400 as `TransientError` and retried to the attempt cap — a retry storm against a deterministic 4xx. Unit tests passed because the fake Gmail client accepted any string as a label id.
**Correct approach:** Resolve user-label names to ids at the worker/client seam (`ensureLabelId`: list → create-if-missing → cache), feed the RESOLVED change to both `batchModify` and the local `mail_messages` label mirror, and classify provider-deterministic 4xx as permanent (fail attempt 1). Fixed in commit fd4ebbb.
**Rule:** (1) A fake provider client must reject what the real provider rejects for the contract under test — if Gmail only takes ids, the fake should throw on a non-id. (2) Any provider error taxonomy needs an explicit permanent-4xx member from day one; "default transient" turns deterministic failures into storms. (3) A verb is not "wired" until one real round-trip has run against the live provider (§8 smoke).
**Enforcement update:** `PermanentError` added to the D203 taxonomy + tests asserting attempt-1 terminal failure on Gmail 400; live-smoke step already mandated by §8 (this entry is the evidence it catches what gates cannot).

## 2026-06-10 — Stale main-checkout worker intercepted worktree jobs mid-smoke
**PR:** N/A (smoke-infrastructure hazard, no code shipped wrong)
**Caught by:** manual live smoke — a reverse job reported `done` with no trace in the worktree worker's log
**What happened:** A 3-day-old worker process from the MAIN checkout was still alive during a worktree smoke. Both processes consume the same local Redis queues, so the stale worker (old module graph) raced the worktree worker and executed an undo reverse job with 3-day-old code. `scripts/dev-up.sh --stop`'s orphan sweep greps for processes whose cwd is under the CURRENT repo root — run from a worktree it can never see main-checkout orphans (and vice versa). This is the exact MISTAKES.md 2026-06-05 stale-worker class, with a worktree twist.
**Correct approach:** Before any worktree smoke, sweep ALL DeclutrMail worker/api processes regardless of which checkout they belong to (`pgrep -f 'src/worker\.ts'` + cwd check against ~/projects/*declutrmail*-ish roots), not just the current root.
**Rule:** One local Redis = one live worker, ever. Verify with `pgrep -lf 'src/worker.ts'` (expect exactly one, in the checkout under test) before trusting any smoke that touches a queue.
**Enforcement update:** Candidate fix: widen dev-up.sh's sweep to match any process whose cwd contains the repo name across sibling worktrees (`wt-*`). Not yet implemented — follow-up; promote to CLAUDE.md §8 smoke checklist if it bites again.

## 2026-06-10 — Upstash free-tier command cap killed the entire async layer for ~41h with no alert
**PR:** N/A (prod incident; remediation on `chore/d156-vendor-billing-guardrails`)
**Caught by:** production — sync-stuck watchdog firing (downstream symptom) + manual log read. NO billing/usage alert existed for Upstash.
**What happened:** The 2026-06-08 worker flip to `min-instances=1` + `--no-cpu-throttling` (the CORRECT fix for the CPU-throttle sync stall) made 9 BullMQ consumers poll Upstash Redis 24/7 — ~150-250K commands/day at IDLE (bullmq `drainDelay` default 5s + `stalledInterval` 30s per worker + repeatable jobs incl. undo-expiry every 5 min). On top of that, the 2026-06-09 6627-sender initial sync + full score sweep. Upstash free tier = 500K commands/MONTH. First `bullmq.error` `ERR max requests limit exceeded. Limit: 500000` at 2026-06-09T01:41Z; continuous until at least 2026-06-10T18:59Z (~41h). The whole async layer was dead: syncs stalled, scoring dead, undo-expiry dead, unsubscribe execution dead. Every existing guardrail covered a DIFFERENT resource — `REASONING_RATE_PER_MIN` (Anthropic), `RATE_LIMIT_ENABLED` (HTTP), the $30 GCP budget (GCP only). Nothing watched Upstash usage; the first signal was a watchdog built for a different failure class.
**Correct approach:** (1) When a worker's lifecycle changes (min=0 → always-on), re-derive the steady-state command volume against EVERY metered backend it touches — an always-on BullMQ consumer's idle polling alone exhausts a 500K/month tier in ~2-3 days. (2) Paid floor for queue infra: Upstash Fixed plan ($10/mo flat, no command cap). (3) Tune BullMQ polling so idle command volume is bounded. (4) Alert on the provider's own rejection error (`scripts/setup-billing-alerts.sh`: log metric `bullmq_max_requests_errors` + email policy, >0 over 5 min) + a vendor-limits watchdog, so quota exhaustion pages in minutes, not 41h.
**Rule:** Every metered third-party service in the hot path needs its own usage/limit alert BEFORE the meter can run out — a guardrail on a different vendor is not coverage, and a downstream watchdog is a symptom detector, not an alert.
**Enforcement update:** `scripts/setup-billing-alerts.sh` (idempotent metric + channel + alert policy); Upstash Fixed plan + usage notifications, vendor watchdog API tokens, and vendor-side hard caps (Vercel/PostHog/Sentry) all tracked as FOUNDER-FOLLOWUPS 2026-06-10 entries.

## 2026-06-10 — Sync-stuck watchdog never passed once: fictional enum values + set -e swallowed the SQL error
**PR:** fixed on `chore/distill-billing-guardrails` (#186)
**Caught by:** manual investigation during the Upstash incident — watchdog "fired" 10/10 runs since creation, including while no sync was stuck
**What happened:** `scripts/check-sync-stuck.sh` queried `current_stage IN ('queued','connecting','syncing')`, but `'connecting'` and `'syncing'` do not exist in the `sync_stage` enum (real values: queued, fetching_metadata, building_sender_index, computing_recommendations, finalizing, ready, failed). Postgres rejected the query on EVERY run → psql exit 1 → `set -euo pipefail` killed the script at the `OUT=$(psql … 2>&1)` assignment with zero output. Every "stuck sync detected" failure email since the workflow's creation was this SQL error, not a stuck sync. The alert was treated as signal during the Upstash incident — it was noise that happened to coincide. Double silent-failure: (1) stderr merged into `$OUT` would have masqueraded a connection error as stuck rows; (2) `set -e` on the command substitution hid even that.
**Correct approach:** (1) `NOT IN ('ready','failed')` — enumerate terminal states (stable) instead of in-flight states (drifts as the enum grows). (2) psql failures exit 2 with the stderr surfaced, distinct from exit 1 = real detection. (3) Smoke an alert's GREEN path AND its FIRE path before trusting it: flip a prod row reversibly (mind `set_updated_at`-style triggers that overwrite injected timestamps — verify the row state you think you created actually persisted).
**Rule:** An alert that has never been green is not an alert — after creating any watchdog, force one PASS and one FIRE before relying on it. Column/enum literals in raw-SQL scripts must be checked against the live schema (`enum_range`), not written from memory.
**Enforcement update:** Script hardened (enum-stable predicate, error/detection exit-code split, DSN sanitization). Candidate hook: CI step that runs each `scripts/check-*.sh` against a seeded PGlite/testcontainer to catch schema-drift in watchdog SQL — promote if a second watchdog rots the same way.

## 2026-06-26 — Structural gates + green CI passed 4 HIGH correctness defects; adversarial review caught them
**PR:** #206, #220, #224 (+ mediums in #201/#219/#226) — review of Fable-5-authored stack
**Caught by:** Claude adversarial-review workflow (skeptical "try to break it" lens + independent self-verification), NOT the structural gate agents and NOT CI — every PR was CI-green and gate-clean.
**What happened:** A compliance gate pass (privacy/architecture/design/types) returned 0 blocking across 8 PRs. A second, adversarial pass over the same diffs found 4 verified HIGH defects the gates structurally cannot see:
- #224 CSV formula injection (attacker-controlled Subject `=HYPERLINK(...)` executes on export open) + a streamed export that reports a mid-stream DB failure as a successful 200 (corrupt file).
- #206 a no-op cleanup (0 messages, status=done) consumed a free lifetime unit, contradicting the PR's own counting rule; and the inbox limit was enforced only at OAuth `/start`, never at the activation mutation (TOCTOU / reconnect bypass).
- #220 `decided_at` set on ENQUEUE not terminal success → a failed async Gmail job silently dropped the sender from the Screener forever; plus a Phase-B→C graduation left a stale quarantine row (sender in Screener AND Triage); plus a ghost-pending TOCTOU (0-message-at-execution emitted no terminal event).
**Correct approach:** Structural gates verify shape (module boundaries, types, tokens, story coverage); they never run the app, so they miss correctness, races, flow-completeness, and "ships green / breaks live" defects (the §8 class). Every substantive PR needs an adversarial pass (default-to-skepticism, attack-surface-first) AND independent verification of each finding before merge — not just the compliance gates.
**Rule:** Green CI + clean structural gates ≠ correct. Run an adversarial "try to break it" review (correctness/data-loss/races/idempotency/auth/flow) + self-verify each finding before recommending merge. Diverse lenses beat one reviewer; verification filters plausible-but-wrong findings.
**Enforcement update:** This session ran the adversarial review as a Claude subagent workflow (replacing the OpenAI Codex CI of #237, closed — no metered quota). Candidate: keep adversarial review as a standard phase of every PR-review workflow. Promote to CLAUDE.md §7/§8 if a third wave of green-but-broken PRs appears.

## 2026-07-17 — I repeated the exact D-number umbrella mis-tag the log warns about
**PR:** #339, #340, #341, #343, #346 (all merged)
**Caught by:** self, reading `IMPLEMENTATION-LOG.md` after merging
**What happened:** I tagged five senders PRs with `Closes D38` / `Closes D51` / `Closes D47` / `Closes D48` by taking the D-numbers from CLAUDE.md §4's topic table ("Senders & screener | D38–D43"), which is an approximate INDEX, not the decision text. The actual rows are:
- **D38 = "First-time education: Onboarding-only tour + tooltips on hover."** Its own log row already says: *"no tour/coachmark code exists; prior '(D38)' tags on PRs #12 and #158–#178 were umbrella mis-tags."* I then made the same mis-tag again, twice (#339, #343). There IS an `[ADR-0012 PATCH 2026-05-25 on D38]` covering senders grouping, which makes the number defensible-but-ambiguous — the merge auto-flip will still mark an onboarding tour that does not exist as shipped.
- **D51 = "Filter UI: Hybrid — 4 quick-filter chips + More filters drawer."** My #340/#341 shipped rollup semantics, grid/table parity, and a replied-cell fix — not the filter drawer.
- **D47/D48 = the Weekly Hero.** #346 **deleted** that feature and closed the rows, so a removal reads as a delivery. The rows were 🟢 Verified citing `senders.controller.spec.ts — Weekly Hero contract`, a spec that PR now deletes: the log cites evidence that no longer exists.
**Correct approach:** Read the actual `### D<N> —` line in `docs/execution/Implementation-Plan.md` (plus its patches) before writing `Closes D<N>`. CLAUDE.md §4's table maps topics to RANGES for navigation; it is not the decision text and must not be used to source a trailer. A PR that RETIRES a decision needs a reversal/retire marker, not `Closes`.
**Rule:** Never source a `Closes D###` from CLAUDE.md §4's topic table — quote the plan's `### D<N> —` title in the PR body so a wrong number is visible at review time. Removal ≠ Closes.
**Enforcement update:** Founder's call — flagged in FOUNDER-FOLLOWUPS 2026-07-17 rather than self-resolved, since correcting D-rows and choosing the retire semantics for D47/D48 is a plan decision (§3). Candidate: have the merge auto-flip action echo the plan's D-title into the log entry, so a mis-tag is loud instead of silent.

## 2026-07-02 — cloud-smoke harness generated an invalid cookie domain (merged before caught)
**PR:** #239 (bug) → #249 (fix)
**Caught by:** Codex stop-time review, post-merge
**What happened:** scripts/cloud-smoke.sh's generated .env.local hardcoded `COOKIE_DOMAIN=localhost`, so the harness API emitted session cookies with an explicit `Domain=localhost` attribute — rejected/ignored by cookie engines (RFC 6265 host-only is the correct localhost form). It also directly contradicted .env.example:130's documented rule ("Local: leave UNSET"), which the real local env follows. The pre-merge audit reviewed the script for prod-path exposure and secrets but never diffed its generated env against .env.example's per-env rules.
**Correct approach:** Any script that GENERATES an env file must be checked variable-by-variable against .env.example's documented per-env guidance, not just for secret leakage.
**Rule:** Generated env ≠ example env — diff generated vars against .env.example's rules as part of reviewing any env-writing script.
**Enforcement update:** Comment anchor added in the heredoc (#249) pointing at .env.example:130-131; none automated (recurrence promotes a check into the script-review checklist).

## 2026-07-02 — Triage engine recommended "Unsubscribe · 95%" for every quiet sender, including the DMV
**PR:** #32 shipped it (D21 Phase C weights + confidence formula); fixed on `fix/d029-unsub-overrecommend`
**Caught by:** founder in the live triage queue (2026-07-02) — donotreply@dmv.ca.gov, American Express Travel, L&T Mutual Fund @ CAMS, Binance support and a personal-ish flexport.com address ALL surfaced as "Unsubscribe · 95%". Flagged earlier in FOUNDER-FOLLOWUPS (2026-06-06). Unit tests, gates, and CI were green the whole time.
**What happened:** Two compounding design flaws in Phase C, both faithful to the D21 spec-as-written: (1) `unsubscribe_score` was built almost entirely from ABSENCE signals — read_rate < 0.05 (+0.40) + < 0.20 (+0.30) + stale last_seen (+0.10) let pure inactivity reach 0.80 with no unsubscribe channel and no volume; (2) `confidence = winner/(winner+loser)` degenerates to 1.0 → clamp 0.95 whenever the loser scores 0, which is exactly the quiet-sender case. On the founder's real 165-sender eval set: 110/165 senders got Unsubscribe, 49 of them pinned at 95% — including senders with NO List-Unsubscribe header, where the recommendation is not even executable.
**Correct approach:** A destructive recommendation must be driven by POSITIVE evidence of actionability (sender-declared List-Unsubscribe channel + active stream volume); disengagement only corroborates. Confidence must reflect strength + margin, not a ratio that maxes out precisely when evidence is one-sided. Eval sets whose labels are auto-generated from the same philosophy as the scorer (Tier A rules ≈ old weights) cannot catch this class — the 97% "cleanup" agreement was the two heuristics agreeing with each other, not with the user.
**Rule:** Never let absence-of-engagement alone drive a destructive verdict; require the action's precondition (a real unsubscribe channel) as a hard gate, and treat any confidence formula that can hit its ceiling with zero counter-evidence as a bug.
**Enforcement update:** Cascade re-weighted with hard gate + strength/margin confidence (this PR); named regression tests pin the DMV/AmEx/newsletter/mailto personas. Candidate: score-eval.ts run with HUMAN-labeled rows (not auto-labels) as a pre-merge check for future weight changes — promote if weights are touched again.

## 2026-07-02 — "you replied" compose chip shipped as a silent no-op (URL state + BE param, no FE wire)
**PR:** D38 compose-strip PR shipped it; fixed on `fix/d038-senders-replied-filter-wire`
**Caught by:** interaction-design review (manual), 2026-07-02 — clicking the chip changed its visual state, the URL, and nothing else
**What happened:** The chip wrote URL state (`?replied=true|not` in use-compose-state.ts) and the BE list endpoint parsed + filtered the param end-to-end (senders.controller.ts `@Query('replied')` → read-service SQL), but the middle of the FE chain never carried it: `UseSendersOptions` had no `replied` field, `ListSendersParams`/`fetchSenders` never mapped it to the wire, and the senders-screen call site never passed `compose.replied`. Five of six compose axes were threaded; this one was skipped. Every layer was individually consistent, so typecheck, lint, gates, and all tests stayed green — the chip even showed a correct mailbox-wide count (`filterCounts.repliedTo`) while filtering nothing.
**Correct approach:** A filter axis is one feature spanning four seams (URL state → hook options → query key → wire params). Land all four in one PR with a cross-layer test that proves the UI toggle changes the wire request (stub returns a distinct row set only when the param is present — the #145 search-test pattern).
**Rule:** For any new list-filter axis, add a screen-level test asserting the chip/control changes the outgoing request's query param AND the rendered row set; a param accepted by the BE but absent from the FE fetcher is undetectable by structural gates.
**Enforcement update:** Regression tests added (senders.test.ts wire-encoding + senders-screen.test.tsx chip-narrows-list). Candidate: checklist item for compose-axis PRs — grep the new param name in all four seams; promote to CLAUDE.md §8 if a second dropped-axis ships.

## 2026-07-03 — Senders table expanded row shipped a seeded fake sparkline as production UI
**PR:** #146 shipped it (rich SenderRowDetail restoration into the ADR-0014 table); fixed on `fix/d049-row-detail-real-timeseries`
**Caught by:** founder-directed audit of production surfaces for fixture data, post-ship. Gates, CI, and tests were green the whole time.
**What happened:** `sender-row-detail.tsx` generated its "Last 12 weeks" chart from a char-code-seeded pseudo-random series (`s.id.charCodeAt(0) * 9301 + 49297`) scaled off `monthly` — a §10 "no fake completion / no hard-coded test data in production paths" violation. The component was written against the fixture dataset (`data.ts` demo mailbox), and the #146 restoration wired it into the real-data table without re-checking which of its inputs were still synthesized. Real per-sender history existed the whole time (`GET /api/senders/:id/timeseries`, D45, shipped #30). A user comparing the expanded row against the same sender's Detail page saw two different "histories" — the trust wedge (D7 posture) cannot afford charts that lie.
**Correct approach:** When promoting a fixture-era component into a wire-data surface, audit every rendered datum for its source; anything still derived from fixture helpers (seeded series, `sampleSubjects`-style pools) either gets wired to its real endpoint or removed. Fetch-on-expand + loading/empty/error states (D211) is the pattern; the Detail page's route/presentational split (D198) keeps the states story-coverable.
**Rule:** No chart/number in a production surface may be derived from a seed, a pool, or a fixture helper — if the real endpoint exists, wire it; if it doesn't, cut the widget rather than fake it.
**Enforcement update:** None automated. The sibling "Recent subjects" list in the same panel still renders the fixture `SUBJECT_POOL` — flagged as a follow-up task (wire to `GET /api/senders/:id/messages` or remove). Candidate hook: grep production `features/**` for imports of fixture-only helpers if this class recurs.

## 2026-07-03 — Composite preview "N /mo" inherited the buckets' INBOX scope and read "0 /mo" for archived-recent senders
**PR:** #272 (fix); shipped originally in the ADR-0020 composite-preview PR
**Caught by:** founder report during the 2026-07-03 senders smoke — D226 unsubscribe preview showed "0 /mo" for a sender whose card said 72 in last 30d
**What happened:** `previewComposite` computed every aggregate — the per-window bucket counts, the recent-subjects arrays, AND the context strip's `monthly` — over one subquery scoped to `'INBOX' = ANY(label_ids)`. The scope is required for the buckets (D226: the preview must equal what the action will move) but `monthly` means "received per month" and must match the senders-list card figure (`last30dMsgs`, label-agnostic). Any sender whose recent mail was already archived rendered "0 /mo" in the confirm modal next to a card saying 72 — two different quantities under the same "/mo" label, on the trust-critical preview surface. Specs were green because the fixture asserted the buggy semantics (`monthly = inbox msgs in 30d`).
**Correct approach:** When several figures share one FROM, check each figure's SEMANTIC scope independently — a predicate that is a correctness requirement for one aggregate is a bug for another. Any number the UI renders under an existing label ("N /mo") must be computed by the same expression as the other surfaces rendering that label.
**Rule:** Two surfaces printing the same labeled metric must share one canonical SQL expression (or one service method); a copy that "rides along" an existing query inherits that query's WHERE and silently changes meaning.
**Enforcement update:** Spec now asserts `monthly` counts a non-INBOX recent message (the regression shape). Candidate: extract shared metric expressions (last30dMsgs) into one SQL helper consumed by both read-service and actions-service if a third consumer appears.

## 2026-07-03 — Sync funnel never closed its started/completed pair; recovery cycles mis-clocked
**PR:** #259 shipped it (D159 core-loop funnel events); fixed on `fix/d159-sync-funnel-pair-reset`
**Caught by:** post-merge code review of PR #259 (SUGGESTION, confidence 70), 2026-07-03
**What happened:** `useSyncGateFunnel` set `observedStartAt` on the first queued/syncing observation and never reset it. Within one gate mount, the transient-failure pattern the status poll deliberately survives (syncing → failed → syncing → ready — see `syncRefetchInterval`, 2026-05-28 logs) dropped its second `sync_started` (the `observedStartAt.current == null` guard still saw the stale start) and clocked the second `sync_completed`'s `duration_ms` from the ORIGINAL start — inflated across the failed period plus the 10s retry gap. All six existing tests drove at most one pass through the ref, so the suite stayed green.
**Correct approach:** A completion closes its pair — reset `observedStartAt` immediately after emitting `sync_completed`, so a re-observed in-progress state opens a fresh pair with its own clock. A `failed` → `ready` flip with no in-progress observation in between now stays silent instead of emitting a second completion clocked from the original start (completions stay strictly paired with observed starts).
**Rule:** A ref that arms a one-shot event pair must be DISARMED when the pair completes, and its tests must drive a full second cycle (start → terminal → start → terminal) with a pinned clock — single-pass tests cannot see a never-reset ref or an inflated duration.
**Enforcement update:** Regression tests added in the fix PR (pinned-clock double cycle with exact `duration_ms` assertions + direct failed→ready pair-closure); both fail against the pre-fix hook. No hook change.

## 2026-07-04 — D226 confirm modal fell back to fixture subjects when the wire was absent
**PR:** dead-code sweep PR (fix); shipped originally with the confirm modal's subjects disclosure
**Caught by:** founder-directed dead-code sweep (instruction #4, 2026-07-04) — the sweep's `sampleSubjects` reference check found a LIVE consumer, not just dead code
**What happened:** `confirm-action-modal.tsx` rendered `subjectsFromWire ?? sampleSubjects(senders[0])` under "Show what will move" — whenever the composite preview's `recentSubjects` was absent, the D226 trust surface listed subjects fabricated from a char-code-seeded fixture pool (`SUBJECT_POOL`). Third instance of the fixture-era-fallback class (seeded row-detail chart, MISTAKES 2026-07-01; row-detail SUBJECT_POOL subjects, fixed #268).
**Correct approach:** Wire data or nothing: `subjectsFromWire ?? []`. The disclosure button is already gated on `compositeCount > 0` (same query), so the loading state renders no disclosure at all — no skeleton needed.
**Rule:** A `??` fallback on a production surface may only fall back to an HONEST value (empty/absent), never to a fixture helper — grep new modals/panels for imports from fixture modules before merge.
**Enforcement update:** `sampleSubjects` + `SUBJECT_POOL` + the rest of the fixture-era helpers (FACETS, detectCohorts, detectPatterns, pick*Slice) are DELETED from `features/senders/data.ts` in the same sweep, so this fallback class can no longer compile against them. Class has now recurred 3× — distillation candidate for CLAUDE.md §10 ("no fixture fallback behind `??`").

## 2026-07-07 — Landing page shipped with no og:image (openGraph config replaced the file-convention card)
**PR:** landing page unit (D134; openGraph block) — found + fixed in the D132 SEO batch PR
**Caught by:** manual prod-build smoke (curl + grep of rendered head) during the D132 SEO batch
**What happened:** `(marketing)/page.tsx` exported `openGraph` without `images`, which shallow-replaced the root segment's metadata and dropped the `app/opengraph-image.tsx` card — `/` rendered no og:image / twitter:image at all, so link shares carried no preview card. Every green gate passed: the gap only exists in the resolved HTML head, not in any config object a unit test inspects.
**Correct approach:** Pin the card explicitly wherever `openGraph` is declared. Now centralized in `features/marketing/page-metadata.ts` (`marketingPageMetadata()`), used by all five marketing pages; `marketing-metadata.test.ts` asserts `og.images`/`twitter.images` on every page, and the prod-smoke checklist includes a curl for `og:image`.
**Rule:** Declaring `metadata.openGraph` on a page = owning the ENTIRE og object, images included — never declare it partially.
**Enforcement update:** shared helper + per-page image assertions in `marketing-metadata.test.ts`; LEARNINGS 2026-07-07 entry documents the merge behavior.

## 2026-07-07 — llms.txt shipped a refund overclaim ("every paid plan / 30-day") contradicting the published policy
**PR:** #283 (D132 SEO batch); fixed on-branch in caf469c by the gate review
**Caught by:** design-system-agent + SEO gate review, [BLOCKING]
**What happened:** The hand-written `public/llms.txt` copy echoed the landing FAQ's "30-day money-back guarantee on every paid plan", which contradicts /refunds (14-day pro-rata window, pending confirmation) on duration and D121 (Pro-only) on scope. The privacy lines in the same file were quoted verbatim from the locked copy module, but the refund line was composed fresh — exactly the paraphrase path the D228 rule exists to prevent, on a surface the microcopy hook never scans (`.txt` is outside its file-type filter).
**Correct approach:** A machine-readable marketing surface must either quote a locked copy module verbatim or stay claim-neutral and link the policy ("paid plans carry a money-back guarantee — see the refund policy for terms", the shipped fix). Never state numbers the legal pages don't state.
**Rule:** A static marketing file may not carry a quantified product claim (price, window, guarantee) unless that exact claim is pinned by a test to its source-of-truth module/manifest.
**Enforcement update:** none yet — the review's fast-follow proposes pinning llms.txt to the locked copy module with a test. The underlying three-surface refund decision is tracked in FOUNDER-FOLLOWUPS 2026-07-07.
## 2026-07-07 — Daily Brief froze a false "quiet yesterday" (zero-count race against lagging sync)
**PR:** #279 (fix); shipped originally with the BriefSnapshotWorker (D61–D70 slice)
**Caught by:** founder manual smoke ("Brief — why is this empty?") — gates, CI, and 42 worker tests were green
**What happened:** The hourly brief tick fired minutes after 00:00 UTC while incremental sync had not yet backfilled yesterday's rows. `buildPayload` counted zero inbound messages, wrote the D70 empty-day brief, and the D69 frozen-once `ON CONFLICT DO NOTHING` locked the false "Your inbox was quiet yesterday" for the entire day. Live repro on the founder mailbox: Jul 6 had 125 inbound rows in the exact window the brief counted as zero. Dev makes the race huge (workers off overnight) but prod has the same window every midnight (mail landing 00:00–first-tick), and any sync outage extends it unboundedly.
**Correct approach:** A frozen snapshot may only freeze a CONFIRMED observation. Freezing "nothing happened" requires knowing sync was caught up through the window's end — otherwise the empty state must stay replaceable. Fix: frozen-once applies only to non-empty briefs; an empty run is rebuilt on later ticks (zero-row rebuilds skip the LLM) and replaced the first time a non-empty payload lands, with a SQL-side emptiness guard against concurrent double-heal.
**Rule:** Never make an ABSENCE-derived result immutable while the pipeline feeding it is eventually-consistent — either gate the freeze on upstream freshness or keep the empty result replaceable.
**Enforcement update:** Two regression tests added (heal on backfill; still-empty no-churn). Candidate follow-up: gate brief generation on `provider_sync_state.history_id_updated_at >= window end` for a stronger invariant.

## 2026-07-07 — Sync-now confirmed enqueue, not completion; caches invalidated before the worker wrote anything
**PR:** #279 (fix); shipped originally in the D38 prod-ready pass
**Caught by:** founder manual smoke ("when I click Sync Now there is no way to see if it really synced, or when")
**What happened:** `useSyncNow` treated the 202 (job QUEUED) as the end of the story: it toasted "Checking Gmail…" and invalidated the feature caches immediately — before the incremental worker had inserted a single row — so fresh mail appeared only after an unrelated refetch or manual reload, and nothing ever confirmed the run finished or when the mailbox was last synced. Worse, the incremental worker only touched `provider_sync_state` timestamps when the CURSOR ADVANCED, so a no-op run left no observable trace at all: completion was structurally invisible. `last_synced_at` existed in the schema since D224 but was written only by initial sync and served by no endpoint.
**Correct approach:** An async 202 needs a completion signal the UI can observe. Stamp `last_synced_at` on EVERY completed run (including no-ops), expose it on the status endpoint, and have the click poll until the timestamp moves past its pre-click baseline (baseline comparison, not wall-clock — clock-skew safe), then re-invalidate caches and confirm to the user.
**Rule:** For any enqueue-and-return mutation, the UI must consume a completion signal (a timestamp/cursor that MOVES on every run, no-ops included) — invalidating caches at enqueue time is fake feedback.
**Enforcement update:** Worker stamps unconditionally + regression test for the no-op run; contract test locks the field. Candidate distillation: §10 "no fake completion" already covers the spirit — add "202-accepted flows must surface a completion signal" if this recurs.

## 2026-07-07 — Retained BullMQ acks turned "Sync now" into a silent no-op; a dead-lettered incremental bricked the cursor forever
**PR:** #279 (fix); the enqueue dedup shipped with the original incremental-sync unit
**Caught by:** integrated-train live smoke (Sync now stuck at "Syncing…" → 90s watch timeout with no worker run)
**What happened:** `ensureIncrementalSyncJob` treated ANY `getJob(jobId)` hit as "already in flight". But the jobId is `${mailbox}__${cursor}`, completed acks are retained 24h (`removeOnComplete: {age: 86400}`) and failed jobs forever (`removeOnFail: false`) — so on a quiet mailbox (cursor unchanged since the last run) every click/webhook/drift enqueue silently dropped against the retained ack. Worst case: a dead-lettered incremental left a failed ack that PERMANENTLY blocked all future syncs at that cursor — no retry path existed at all. The sibling helper `ensureInitialSyncJob` had already solved this exact class ("terminal residue must not block reconnect", Codex iter 5/6); the incremental variant never got the same treatment.
**Correct approach:** Dedup must distinguish LIVE states (waiting/active/delayed → noop) from TERMINAL residue (completed/failed/unknown → remove + re-add), with the remove-rejects lost-race treated as noop. Re-running a completed cursor is a safe server-side no-op that stamps `last_synced_at` — exactly the completion signal the D38/D224 watch consumes.
**Rule:** A jobId-dedup guard on a retained-ack queue MUST check `getState()` — `getJob() !== null` is not "in flight". When two ensure-helpers guard sibling queues, a residue rule added to one must be ported to the other in the same PR.
**Enforcement update:** `ensureIncrementalSyncJob` now mirrors `ensureInitialSyncJob`'s residue semantics; 9 FakeQueue tests lock added/replaced/noop/lost-race. Live-verified: the exact bricked jobId (`…__63644798`) ran after replacement.

## 2026-07-09 — No-active-mailbox gate trapped account deletion + billing (whole-screen takeover, unconditional on pathname)
**PR:** (this PR — branch `claude/vigilant-thompson-wb4lz4`)
**Caught by:** product audit (manual QA of in-app trust/legal reachability)
**What happened:** `AppChrome`'s branch ladder took over the ENTIRE screen with the `NoActiveMailbox` reconnect gate whenever `me.activeMailboxId == null`, unconditional on the current route — it returned only `GracePeriodBanner + NoActiveMailbox + ToastHost` and never rendered `{children}`. So a user who disconnected their LAST Gmail could not reach `/settings` (→ Account → delete account + data export, D216) or `/billing` (→ cancel + the 30-day refund, D121). Account-level flows are user-scoped, not mailbox-scoped, but the gate treated "no mailbox" as "no app." This is the §8 "shipped green, broke live" class: the gate passed every structural gate (it renders a valid state) but the FLOW — reach account deletion with zero mailboxes — was never enumerated.
**Correct approach:** A whole-screen takeover gate must exempt the routes that are reachable in the gated state. Let user-scoped routes (`/settings`, `/settings/*`, `/billing`) fall through to the normal shell; keep the reconnect gate for mailbox-scoped routes. Because the fallback reuses the main shell WITHOUT an active mailbox, every mailbox-scoped chrome piece that polls session-scoped state must be gated off too — here `SyncErrorBanner` AND `SyncNowButton` both call `useSyncStatus()` (session-resolved) with a 3s `refetchInterval`, which 409-storms `NO_ACTIVE_MAILBOX` (the retry cap stops the initial retry, but `refetchInterval` re-issues regardless). Gating both on `hasActiveMailbox` closes it; the sender/screener count queries were already `enabled: hasActiveMailbox`.
**Rule:** A takeover/interstitial gate keyed on server-resolved scope (`activeMailboxId == null`) must carry a route allowlist for the account/billing surfaces that outlive the scope — enumerate `| route | gated? | still-reachable? |` before shipping. The allowlist must be EXACT routes, never a path PREFIX: a `/settings/` prefix wrongly admits mailbox-scoped subroutes (`/settings/senders` reads session-scoped `useSenders` → dead-end 409 with no reconnect path). When a route renders through the gate on the shared shell, audit EVERY chrome poll for the same 409-storm the gate exists to prevent (`refetchInterval` bypasses the 4xx retry guard).
**Enforcement update:** `isUserScopedRoute` exact-match allowlist (`/settings`, `/settings/privacy`, `/billing` — NOT a `/settings/` prefix, so `/settings/senders` keeps the gate) + `hasActiveMailbox` guards on `SyncErrorBanner`/`SyncNowButton` in `layout.tsx`; 5 layout tests pin the fallback (renders children, no reconnect gate, no sync-status poll), the still-gated mailbox routes (`/senders`, `/settings/senders`), and the user-scoped `/settings/privacy`; escape-hatch links added to `NoActiveMailboxView`. The over-broad prefix was caught pre-merge by `design-system-agent` + `flow-completeness-auditor` — candidate to extend the flow-auditor's state-matrix check to "gate takeover vs pathname."

## 2026-07-15 — Raw-sql Date params 500'd evidence links and corrupted every support-bundle export (pglite-green, postgres.js-dead)
**PR:** #334 (draft, branch `codex/d246-behavioral-activation-trust`; fixes `4ccf55e2` + `df8af6aa`)
**Caught by:** two-account dev smoke (weekly-review Skipped/Protected links showed an empty list; export unzip failed "End-of-central-directory signature not found")
**What happened:** Two new D246 queries compared raw `sql` expressions against JS `Date` params: `loadRuleReviewRows` wrapped `resolvedAt` in a `sql` template, and `loadCurrentExecutionAttempts` used a failed-terminal-time CASE. Drizzle only maps Dates through a COLUMN's encoder — next to a raw expression the Date reaches postgres.js untyped and throws (`The "string" argument must be of type string… Received an instance of Date`). Result: `GET /api/activity?outcome=skipped|protected` → 500 (weekly-review evidence links dead), and the export stream died mid-zip AFTER the 200 header — a silently corrupt bundle. All 62 Activity API tests were green because specs run on PGlite, which happily serializes Dates. Same root class as the 2026-06 "Drizzle raw-sql param pitfalls" learning — it recurred because nothing enforced it.
**Correct approach:** Use the column ref when one exists (encoder handles Dates); when the expression must stay raw (CASE), bind `value.toISOString()` with a `::timestamptz` cast. For the test gap: intercept the driver in specs and assert no raw `Date` instance is ever handed to it.
**Rule:** Never bind a JS Date next to a raw `sql` expression — column ref or ISO-string + `::timestamptz`, always. A streaming 200 is not success: exports must be verified by UNZIPPING the bytes, not by status code.
**Enforcement update:** Driver-parity spec in `activity.read-service.spec.ts` (wraps PGlite `query`, fails on any raw Date param); truthful CSV labels pinned in `activity-support-bundle.service.spec.ts`. Third recurrence of the drizzle raw-sql param class — distillation candidate for CLAUDE.md §2/§8.

## 2026-07-15 — Data-cleanup UPDATE dropped the guard its sibling had, nearly wiping user-agency pins
**PR:** #335
**Caught by:** schema-migration-reviewer (local gate run) — [BLOCKING]
**What happened:** Migration 0045 demotes two classes of stale auto-protections with two UPDATEs. The first (gmail_important, non-primary) carried `is_protected = true`; the second (legacy engagement_based/vip) did not, so it also matched manual-unprotect memory pins (`is_protected = false` with reason kept) and would have NULLed their reason — converting the user's sticky override into a fresh row the sweep may re-protect. The header comment simultaneously promised pins were untouched, and mislabelled manual protections as `reason IS NULL` (they carry `'user_defined'`; the 0023 CHECK makes protected+NULL impossible).
**Correct approach:** Every statement in a multi-statement cleanup must re-state the full invariant guard — copying the WHERE shape from the sibling statement, not just the target predicate. State-machine columns like `(is_protected, protection_reason)` encode user agency in the COMBINATION; filtering on reason alone selects both machine rows and user pins.
**Rule:** In any UPDATE/DELETE touching `sender_policies.protection_*`, require the explicit `is_protected` state alongside the reason — and verify comments against the schema CHECKs, not memory.
**Enforcement update:** none (schema-migration-reviewer caught it; keep running it locally on migration PRs before push).

## 2026-07-15 — In-place migration edit reached PRODUCTION (enum drift, hours of downtime)
**PR:** #333 (D245, the in-place edit) → detected via #335's failed prod Migration-apply → fixed by #336
**Caught by:** production ("Migration apply" step failed on #335 merge: `invalid input value for enum protection_reason: "gmail_important"`)
**What happened:** D245 edited migration 0006 IN PLACE (prelaunch "no compatibility shims" doctrine) to add `replied`/`starred`/`gmail_important` to the `protection_reason` enum. Production had already applied the OLD 0006; atlas tracks migrations by version number, not content, so it never re-ran 0006 and the new values never reached prod's enum. From #332's deploy (06:19 UTC) the live `applyAutomaticProtection` sweep threw on every qualifying sender, rolling back the ENTIRE enclosing sync transaction (sweep runs last inside the same `db.transaction()` as sender_timeseries + orphan checks). Silent for ~15h because "Migration apply" reported success (nothing to do) and the failure only surfaced inside the worker. The same-session dev DB hit this exact class earlier (memory `dev-db-0036-blocker`) — treated as dev-only, so the prod exposure wasn't anticipated.
**Correct approach:** In-place migration edits are safe ONLY for environments that have not yet applied the edited version. Any migration already applied to a long-lived DB (prod, or a persistent dev DB) needs a NEW forward migration to change it. Enum additions specifically: `ALTER TYPE ... ADD VALUE` in its own migration version, and any statement USING the new value must be a SEPARATE later version (Postgres forbids add+use in one transaction — this also broke the first fix attempt, #335's bundled 0045).
**Rule:** Prelaunch "edit in place" stops at the water line of any already-applied database. If prod (or a persistent dev DB) ran vN, changing vN is a new migration vN+1, never an edit to vN.
**Enforcement update:** none yet — candidate for a CI check that diffs already-applied migration files against their git history, or a CLAUDE.md §2/§10 carve-out to the D245 in-place doctrine. Flagged for founder distill.

## 2026-07-15 — Vendor watchdog was blind to the exact failure it existed to catch
**PR:** #337 (fix)
**Caught by:** manual triage of the prod login incident (the watchdog itself stayed green)
**What happened:** Upstash Redis budget-suspended prod for hours; the daily vendor-limits watchdog reported `Upstash Redis 🟢 OK 0%` throughout. `checkUpstash` gauged command VOLUME only — a suspended DB runs 0 commands, so it read 0% = healthiest exactly when dead. Separately, Vercel's billing endpoint times out most days → the check threw → classified ERROR → `exit 1`, so the run went red daily and the red was tuned out, burying any real breach.
**Correct approach:** A health guardrail must check LIFECYCLE STATE (active/suspended), not just usage-vs-threshold — the most dangerous state (suspended) produces the lowest usage number. And a transient fetch failure (timeout) must not be fatal, or one flaky vendor trains the operator to ignore the whole signal.
**Rule:** Watchdogs assert on state first, volume second; transient errors are WARN, real breaches/suspensions are the only things that page.
**Enforcement update:** #337 — `checkUpstash` BREACHes on any non-`active` DB state (all DBs scanned); request timeouts downgraded to WARN.

## 2026-07-20 — Every Paddle first purchase was silently dropped, then the fix introduced a stuck state
**PR:** branch `fix/d117-paddle-custom-data-key` (D117, D180)
**Caught by:** founder sandbox smoke (a real $9 test purchase never flipped the tier) — then the follow-on defect by the Codex stop-time review
**What happened:** Two defects, one shipped and one nearly shipped.
(1) `paddle.adapter.ts` WROTE checkout attribution as `customData: { workspaceId }` while the webhook READ it as `custom_data.workspace_id`. Paddle stores the object verbatim, so `workspaceId` was always null; on a first purchase neither the `subscriptions` nor `billing_customers` fallback exists yet, so `resolveWorkspace` returned null and the event was discarded — HTTP 200, no subscription row, tier never flips. Severity multiplier: the discard path called `markProcessed()`, so the insert-first dedup gate made every provider retry return `duplicate`. A real payment became permanently unrecoverable behind a success response. 59 tests passed throughout: `fixtures.ts` hand-wrote the reader's shape and the adapter spec asserted the writer's shape as a literal, so neither side ever met; two service specs asserted `processedAt !== null` on dropped events, encoding the data loss as intended behavior.
(2) The first fix attempt made `cancel_at_period_end` sticky (`existing OR excluded`) to stop renewals from clobbering a refund flag. But an un-cancel in Paddle's portal and an ordinary renewal arrive as the SAME payload (`scheduled_change: null`, status active), so nothing could ever clear it — trading a silent un-cancel for a permanent false "cancellation scheduled" on live subscriptions. The paired chargeback-revokes-now change had the same shape: writing `tier='free'` is re-granted by the next `subscription.*` event from `entry.tierId`.
(3) Removing the `markProcessed` stamp (the fix for 1) made unresolved events re-drivable — and therefore able to arrive OUT OF ORDER. A `subscription.created` that only becomes attributable after a `subscription.canceled` has landed would re-drive and upsert `status: active` over the cancel, handing entitlement back to a churned user. Providers publish no reliable monotonic sequence and `occurred_at` lives only inside the audit payload, so arrival order (`subscription_events.created_at`, stamped on first receipt and preserved across retries) is the ordering truth.
(4) The first cut of that staleness guard matched on `payload->>'provider_subscription_id'` alone — but `projectWebhookPayload` writes that key for PAYMENT events too. Since `transaction.completed` is exactly what seeds `billing_customers` to make a stranded activation attributable, the guard discarded the activation its sibling fix existed to rescue: strand → seed → retry → "stale" → payment lost again. The two fixes cancelled each other out, and the existing test missed it by processing the transaction FIRST rather than in the order production delivers.
(5) Two more from the same review round. (a) `custom_data` reaches Paddle THROUGH THE BROWSER, so the workspace id was attacker-controlled — a forged checkout could attribute a paid subscription onto another workspace, and the new `transaction.completed` seeding made it worse by MINTING a `billing_customers` mapping from that forged value, poisoning attribution for every later event on that customer. (b) The staleness guard read `subscription_events` outside the write transaction, so two concurrently-delivered events could both observe "no newer event" and both upsert.
**Correct approach:** (1) Any value that leaves the process and returns through a third party needs ONE round-trip test — feed the writer's real output through the reader; a fixture that spells out either side's key can only prove that side against itself. (2) Do not encode local intent in a column the provider also owns. Local-vs-provider cancellation is a PROVENANCE question and needs its own field; without it, either direction of the conflict is a bug.
**Rule:** Writer→provider→reader round-trips get a test that names the wire key exactly once. Never make a provider-mirrored column locally sticky — if local state must survive provider events, store where it came from. Any event made re-drivable must also be made ORDER-SAFE in the same change: retryability and staleness are one decision, not two. Data that round-trips through a CLIENT is attacker-controlled even when the server originated it — sign it and verify on return. A read-then-write guard must sit inside the write transaction, under a lock keyed on the entity it protects. An ordering guard must key on events that WRITE the state being guarded — a shared correlation id is not evidence of a competing write, and a test must exercise the provider's real delivery ORDER, not a convenient one.
**Enforcement update:** SPLIT ACROSS TWO PRs after the fix set kept growing (founder call). **PR A (money path):** snake_case `custom_data` + a `paddle.adapter.spec.ts` round-trip test that feeds `createCheckout` output through `mapWebhookEvent` (fixtures now accept a raw `customData` echo, so writer and reader finally meet); signed attribution with tests refusing unsigned / forged / valid-for-another-workspace blobs; `transaction.completed` seeds `billing_customers` as a second attribution link. **PR B (webhook recovery + ordering):** removing the `markProcessed` poison-pill, the 503 `BILLING_WEBHOOK_UNRESOLVED` retry path, the per-subscription advisory lock across all three writers, and the staleness/ordering guard — that whole cluster exists BECAUSE making events re-drivable also makes them arrive out of order, so it ships and is reviewed as one unit. Refund/chargeback entitlement left UNCHANGED in both, gap documented in code — needs the provenance column. Third repeat of the "green tests, broken at the seam" class (see UI truth-bug memory) — distillation candidate.

## 2026-07-20 — 9th billing defect: occurred_at ordering clobbers on ties (found by independent review, not CI)
**PR:** #364 (branch fix/d117-billing-webhook-recovery)
**Caught by:** an independent adversarial review agent run BEFORE merge — CI was fully green and my own live-smoke of three sequences had passed
**What happened:** The round-8 change made `occurred_at` the PRIMARY order with arrival only a null-fallback. But `occurred_at` is not a total order — Razorpay stamps unix SECONDS, so any two same-subscription events in the same second tie, and the strict `peerMs > selfMs` treated a tie as "not newer" → the incoming (older-intent) event applied and CLOBBERED newer state. Two triggers: (A) a stale active event sharing a cancel's second, arriving last, resurrected a churned subscription back to Pro; (B) a user-cancel marker could be reverted by an in-flight renewal sharing its millisecond — a regression, since the prior round guaranteed the marker won via arrival order and round 8 removed that. No Razorpay ordering test existed at all, so the realistic (second-granularity) path was entirely unexercised.
**Correct approach:** No event-stream signal can order a same-second stale re-delivery — it genuinely arrives/inserts last, so arrival AND a monotonic sequence both favor it. The money-critical case is closed by a DOMAIN INVARIANT instead: `canceled` is terminal on both providers (a subscription id never reactivates), so a terminal-canceled floor refuses any event moving a row out of canceled. Exact ties elsewhere fall back to arrival with `>=` (conservative: refuse rather than overwrite a committed peer). Residual: non-terminal same-second conflicts (e.g. paused↔active) are still arrival-ordered — closed only by the reconciliation backstop (filed).
**Rule:** occurred_at is not a total order — never treat an equal event-time as "apply". For irreducible ordering ambiguity, protect the money-critical transition with a domain invariant (terminal states are terminal), not with a timestamp tiebreak that cannot exist.
**Enforcement update:** terminal-canceled floor in `applySubscription`; `isNewer` ties fall back to arrival `>=`; added Paddle exact-tie + Razorpay same-second resurrection tests (both verified red without the floor). Ninth defect in this billing arc — the standing lesson (independent review + live smoke, never trust green CI) is now load-bearing, not advisory.

## 2026-07-20 — 10th billing defect: terminal floor over-reached; my own tie fix was backwards
**PR:** #364 — found by a SECOND independent review of the fix for the 9th defect, plus a Codex gate
**What happened:** Two problems in the terminal-canceled floor commit. (1) The floor treats `canceled` as absorbing, but both adapters funnelled any UNRECOGNIZED provider status into `canceled` via a `default` catch-all. So a spurious/unknown status manufactured a terminal `canceled`, and a later real paid activation was then permanently refused — silent Pro lockout, no recovery. Pre-floor the row self-healed (the next active overwrote it); the floor removed that. (2) My tie-fallback used `>=` on arrival, which fixed the clobber direction but opened the opposite one: an exact double-tie (equal occurred_at AND equal created_at) would DISCARD a real cancellation in favour of a committed active peer — Codex flagged it. Strict `>` is correct: whichever event arrived later is newer, so a real later cancel applies and a stale earlier active does not, while the resurrection case (stale active arrives last) is caught by the floor rather than the comparison.
**Correct approach:** A lossy status mapping must never manufacture a TERMINAL state from an unknown input — unrecognized status → ignored (no state write), which self-heals. And a symmetric timestamp comparison cannot resolve a tie safely; strict `>` plus a domain invariant (canceled is terminal) is the combination that is correct in both directions. Prove tie-sensitive fixes with a test that PINS created_at (sequential tests get distinct now() and cannot force the tie).
**Rule:** `default` in a provider status map returns null/ignored, never a terminal state. Tie comparisons are strict `>`; protect the money-critical transition with a domain invariant, not a `>=`.
**Enforcement update:** both adapters `default → null → ignored`; `isNewer` reverted to strict `>`; added a pinned-created_at double-tie test and an unrecognized-status heal test, both verified red against the pre-fix code. Tenth defect — two independent reviewers plus Codex each found a distinct one that green CI + my own smoke missed. The lesson is now non-negotiable: high-churn concurrency code gets an independent adversarial review before merge, every time.

## 2026-07-20 — 11th billing defect: terminal floor guarded canceled but not paused
**PR:** #364 — found by the THIRD independent review (final pre-merge pass), CI green + prior review clean
**What happened:** The terminal-canceled floor (10th-defect fix) protected `canceled` from same-event-time stale-active resurrection, but `paused` is ALSO a non-granting, tier-locking state (D118: "Pro features lock during pause"; `GRANTING_STATUSES` excludes it) and got no equivalent guard. Sequence: activate → pause (tier→free) → a stale `active` sharing the pause's event-time (Razorpay second granularity), delivered after → ties on occurred_at → arrival fallback lets it through (pause arrived first) → floor only checks `canceled` → upsert active → tier re-granted to pro while the sub is paused, and it persists (provider won't re-send the acked pause). The canceled fix was scoped too narrowly to the one state its test covered.
**Correct approach:** The protection is not about `canceled` specifically — it is "a granting event must not overwrite a committed NON-GRANTING state on an unresolved event-time tie." That covers paused and canceled uniformly. It belongs in the tie fallback (where occurred_at is available), NOT an unconditional floor: a genuine resume has a strictly-later occurred_at, is resolved by the ordering branch, and must not be blocked. When fixing a resurrection/clobber class, enumerate ALL states in the equivalence class (every non-granting status), not just the one with a failing test.
**Rule:** Entitlement-protection invariants are keyed on the GRANTING/non-granting property, not on a single status literal. A fix scoped to the state that happened to have a test is a fix scoped too narrowly.
**Enforcement update:** `isNewer` tie-fallback refuses a granting event over a committed `paused`/`canceled` peer; added paused-resurrection test (verified red without the clause) AND a genuine-resume test (verified it still applies — the fix must not block real resumes). Eleventh defect; the money path (#362) has been merged and correct throughout — every defect in this arc was in #364's recovery+ordering cluster.

## 2026-07-20 — advice to delete repo-level billing secrets would have blinded the watchdog
**PR:** #365 (branch chore/d117-provision-billing-envs) — caught pre-merge by Codex stop-review
**What happened:** Moving the provisioning workflow to environment-scoped secrets, I advised (runbook §4 + PR body) deleting the now-"leftover" repo-level `PADDLE_API_KEY` / `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. But `vendor-limits-watchdog.yml` (D156, scheduled daily) reads those SAME repo-level secrets for billing webhook-delivery health checks. Deleting them would not error — the script maps absent secrets to UNCONFIGURED and skips, so the watchdog stays GREEN while silently monitoring nothing. A surgical-change miss: I checked the workflow I was editing but not the other consumers of the secret it referenced. The watchdog also can't share the reviewer-gated `production` environment — a required-reviewer gate hangs scheduled cron runs.
**Correct approach:** Repo-level billing secrets STAY (watchdog, production keys). The two GitHub Environments are for the provisioning workflow only; defining all three in both means provisioning never falls back to the repo-level copies. Two consumers, two homes, documented.
**Rule:** Before advising deletion of a shared secret/var/resource, grep every consumer (`grep -rn secrets.NAME .github/workflows/`), not just the file in hand. A scheduled job that degrades to "skipped" instead of "failed" hides the breakage.
**Enforcement update:** runbook §4 + provisioning workflow comment now explicitly forbid deleting the repo-level billing secrets and name the watchdog dependency.


## 2026-07-26 — A 409 handler named a cause it had never read

**PR:** #394, #393
**Caught by:** Codex stop-time review
**What happened:** Fixing the stale-protection retry loop, I branched the
recovery on `err.status === 409` and toasted "Sender X is Protected — reopen
the action to confirm anyway". But 409 is not exclusive to `PROTECTED_SENDER`:
`CurrentMailboxGuard` runs in front of every one of those endpoints and answers
409 with `NO_ACTIVE_MAILBOX` / `SELECT_MAILBOX` / `MAILBOX_NOT_OWNED`. A user
with no connected mailbox got told something false about their SENDER, the real
designed state (picker / reconnect gate) stayed hidden, and the recovery
refetch hit the same guard again.

This is the house defect class — a surface asserting what it does not know —
committed while fixing that same class, in the same session, on four handlers.
The status code was at hand; the envelope's `error.code` (D202) was one field
away. The pre-existing copy had the same status-only check, so I inherited the
shape and made the claim MORE specific without narrowing the condition.

**Correct approach:** an error's HTTP status says how it failed, never why.
Copy that names a cause must read `error.code`.
**Rule:** never branch user-facing copy or recovery on a bare 4xx status when
the envelope carries a code — and check what else can emit that status,
starting with the guards in front of the route.
**Enforcement update:** `apiErrorCode()` in `lib/api/client.ts` (documented with
the exact guard codes that share 409); tests in
`triage-screen.actions.test.tsx` and `screener-protected-override.test.tsx`
assert a `NO_ACTIVE_MAILBOX` 409 is not dressed up as protection.
## 2026-07-26 — Enabled a verb without wiring the override it needed; trusted a subagent's negative claim
**PR:** not yet opened (branch `fix/d226-archive-window-single-sender`, commits `dc05bf3f` → fixed by `ea35d8a2`)
**Caught by:** Codex stop-time review ("protected-action overrides are not wired through every newly enabled path")
**What happened:** Unblocking destructive verbs on protected senders (D245: bulk/automatic only) required passing `override` so the server's 409 `PROTECTED_SENDER` becomes the designed confirm instead of an error. I wired it on the two Senders surfaces and missed Triage — which has no protected check of its own but rides the SHARED `POST /api/actions` composite endpoint and therefore inherits one. The result was strictly worse than the bug being fixed: an honest disabled button became a live button that always 409s into an error toast. The root cause of the miss was accepting an investigating agent's negative claim at face value — "the server has no protected check on the triage act path" — which was true of the triage module and false of the endpoint it calls.
**Correct approach:** When removing a client-side gate, enumerate every call site that now reaches the server and check what the SERVER does on each — following the actual endpoint, not the feature module. A negative claim ("X has no check") deserves the same verification as a positive one, and is more dangerous because it reads as permission.
**Rule:** Before unblocking any path, list every enqueue site the unblocked verb can reach and confirm the request shape each one sends; a subagent's "there is no check" is a hypothesis until you have read the endpoint it actually calls.
**Enforcement update:** none yet — candidate: a test that asserts wire-body shape (not just "the call happened") for every surface that can reach a guarded endpoint. The four new both-directions override tests are the start of that pattern.

## 2026-07-26 — Applied a founder UX decision to one surface and called it done
**PR:** not yet opened (branch `fix/d226-archive-window-single-sender`, commit `198612a2`)
**Caught by:** Codex stop-time review ("protected-sender override lacks explicit acknowledgement")
**What happened:** The founder chose "acknowledgement line + `<verb> anyway` button" for acting on a Protected sender. I shipped it in the Senders confirm modal, then wired `override: true` into Triage in a later commit **without** the acknowledgement — so Triage silently overrode a protection the user never chose (auto-protect fires on ≥3 replies). Worse, Triage has TWO preview paths: the ActionSheet, and the inline preview that D226 renders when D34's remember-preference skips the sheet. They do not share a component. Fixing only the sheet would have meant that skipping the sheet also skips the notice while `override: true` still goes on the wire.
**Correct approach:** A UX decision applies to the BEHAVIOUR, not to the first surface that implements it. Before calling one done, enumerate every surface that can reach the behaviour — and in this codebase specifically, remember that "the D226 preview" is two components (modal/sheet + inline), not one.
**Rule:** When a founder decision governs a user-facing moment, list every component that renders that moment before implementing, and assert the decision on each; for anything D226-related, that list always has both the sheet/modal path and the inline path.
**Enforcement update:** none yet — candidate: a shared `<ProtectedOverrideNotice>` primitive so the two preview paths cannot drift, or a test helper that runs the same assertion against every preview surface.

## 2026-07-26 — Opening a verb on Protected senders created a partial execution

**PR:** #394 (https://github.com/CT2689-Tech/DeclutrMail/pull/394)
**Caught by:** Codex stop-gate review
**What happened:** C3 split `canUnsubscribe` so Protected senders could be
unsubscribed by an explicit click. Unsubscribe has no server-side Protected
guard, so the intent always lands — and for one-click that is a real, one-way
RFC 8058 request (D58). The paired "also act on past emails" backlog action is
a SEPARATE composite POST, and it did not carry the `override` the preview had
already collected. Result: server 409s the second half AFTER the irreversible
first half ran. The user ends up unsubscribed with their mail untouched, told
only "Unsubscribe queued, but couldn't archive the backlog". Two surfaces
(`senders-screen.tsx`, `sender-detail-page.tsx`).

I had wired `override` into every composite call I could see — including
triage's archive-after-unsub — and still missed these two, because they build
their request object at a different call site from the one the modal feeds.

**Correct approach:** when a change makes a verb newly REACHABLE for a class of
sender, enumerate every request that verb can emit, not every place the verb's
name appears. Unsubscribe emits two.
**Rule:** a flag collected once in a preview must reach EVERY request that
preview authorises — grep the flag, then grep the endpoint, and diff the two lists.
**Enforcement update:** two-sided tests in `senders-screen.test.tsx` pinning
`override: true` / `override: false` on the backlog composite; verified to fail
without the fix.

## 2026-07-26 — A 409 handler that did not refetch made the retry loop forever

**PR:** #394
**Caught by:** Codex stop-gate review
**What happened:** Once an explicit action carries `override` whenever the row
says Protected, a 409 `PROTECTED_SENDER` can mean only one thing — the client's
protection data is stale. The Senders, Sender Detail and Triage handlers kept
the old copy ("unprotect it first") and did not refetch, so the cached row still
said unprotected, the reopened modal omitted the acknowledgement and the
override, and it 409'd again. Forever. I shipped the refetch in the Screener,
listed the other three as a "known follow-up" in the PR body, and moved on —
but the loop is a REGRESSION of the same PR that made Protected senders
actionable, not a pre-existing wart.
**Correct approach:** if a PR changes what an error code MEANS, every handler
reading that code is in scope for that PR.
**Rule:** a designed 4xx that the client can resolve must invalidate whatever
made the client wrong; otherwise the retry is the same request.
**Enforcement update:** `triage-screen.actions.test.tsx` contract inverted with
the reasoning recorded inline (it previously asserted NO invalidation).

## 2026-07-26 — Correcting a false message left a dead end in its place

**PR:** #394
**Caught by:** Codex stop-time review (third pass on the same handler)
**What happened:** Having stopped calling a `CurrentMailboxGuard` 409 a
"Protected sender" problem, I let those conflicts fall through to a generic
"Couldn't archive X" toast and refetch NOTHING. But the guard's 409 means the
client's active mailbox no longer resolves — disconnected in another tab,
switched, revoked. Reads already treat that as a designed state and the app
shell renders the reconnect gate off `me`; a MUTATION had no such recovery, so
the user stayed on a screen full of a mailbox that no longer exists with no
route to the gate. CLAUDE.md §8 names both halves of this — "scope change ⇒
reset scoped cache" and "a read guard's 4xx is a designed state" — and I
satisfied neither, having fixed only the sentence.

**Correct approach:** when a handler stops mis-attributing an error, the
question is not "what do we say instead" but "what is the designed recovery for
what this error actually means". Silence is not a fix.
**Rule:** every designed 4xx needs a route to its recovery UI, not just honest
copy. If reads have one and mutations don't, mutations are the bug.
**Enforcement update:** ONE global `MutationCache.onError` in
`makeQueryClient` resets the mailbox-scoped cache on `NO_ACTIVE_MAILBOX` /
`SELECT_MAILBOX` / `MAILBOX_NOT_OWNED` — mirroring how entitlement 402s already
route to the upgrade gate — so every mutation surface recovers, not only the
handlers someone remembered to wire. Tests in `query-client.test.ts` cover all
three codes plus three negatives, verified to fail without the handler.

## 2026-07-27 — Two launch-completion defects of one shape: a gate inferred from the wrong layer
**PR:** #401, #402 (fix commits 206748d2, 4d90bc75)
**Caught by:** Codex stop-time review
**What happened:** (1) A3 opened the composite wire's `messages` selector to metered Free via the multi-sender knob without re-checking what the newly-reachable path charges — one unit for 500 messages across any number of senders. (2) The A6 derive layer freed the plan picker for non-backing subscription rows on the reasoning "the entitlement is granted from elsewhere," but the server's SUBSCRIPTION_EXISTS guard keys on STATUS, not backing — every offered checkout was a dead-end 409.
**Correct approach:** When a change makes a path reachable or re-derives a client-side gate, enumerate the SERVER predicate that path will actually hit and mirror it exactly — never re-derive the rule from the concept (backing, tier) when the server enforces a different axis (status, unit charge).
**Rule:** A client affordance gate must quote the server predicate it fronts; a retier must re-run the invariants of every path it newly exposes.
**Enforcement update:** none (both now pinned by tests: wire-rejection test on the selector; status-set unit tests on the picker lock).

## 2026-07-27 — Two numbers from different populations, rendered as one story
**PR:** (this branch)
**Caught by:** founder hand-smoke on prod (`app.declutrmail.com/senders`)
**What happened:** The Delete preview for `ealerts.bankofamerica.com` read "71 /mo"
above five window chips that ALL said 0. Both numbers were correct: `monthly` is
arrival-scoped (last 30 days, any label) while the bucket counts are state-scoped
(currently carrying `INBOX`) — the sender mails 71×/month and every one was already
archived. Verified against the dev DB (71 recent messages, all `Label_23`, none
`INBOX`). Nothing on screen named either scope, so a correct preview read as a broken
one. This was already logged as finding 5.14 in
`docs/execution/action-surface-findings-2026-07-26.md` — dismissed there as "by design,
reads as a bug" and left unfixed for a week until the founder hit it.
Fixing it surfaced a second, harder defect: `nothingToActOn` gated only Archive and
Delete, so **Later** kept an enabled confirm at a zero count — enqueueing a job and
rendering a receipt for moving nothing.
**Correction, same session:** I first wrote that this also spent a Free cleanup unit. It
does not — `cleanupUnitsUsed` excludes `status='done' AND affected_count=0`, verified
against the live DB. I read `COUNTS_AS_CLEANUP.later === true` and stopped reading the
predicate three lines later. The over-claim was mine; the real defect is that the modal
footer promises "Uses 1 of your N cleanup actions" for an action that costs none.
**Correct approach:** Two numbers with different denominators on one surface must each
name their scope, and a zero that contradicts a visible figure must explain itself
rather than leaving the reader to infer a bug. "By design, reads as a bug" is a bug
report, not a disposition — the same sentence that dismissed 5.14 predicted this report.
**Rule:** Any surface showing an arrival or all-labels received volume beside an
INBOX-now action count must label both scopes and reconcile a zero. Any verb whose whole effect is
`currentMail` must be un-confirmable at count 0 — check `COUNTS_AS_CLEANUP` before
deciding a no-op is harmless.
**Enforcement update:** `describeInboxScope` / `inboxScopeNoticeCopy`
(`packages/shared/src/actions/inbox-scope.ts`) is now the ONE place that classifies the
gap; the senders confirm modal and the screener decide preview both render from it
rather than mirroring the logic. `nothingToActOn` keys on `primaryActsOnInbox`, and the
duplicate narrower test in `confirmDisabled` was deleted so it cannot silently
re-exclude a verb again. 12 shared + 12 modal tests pin the copy, the chip-row
suppression, the composite verb naming, and the Unsubscribe non-regression.

## 2026-07-27 — Three guesses at a word an ADR had already decided
**PR:** (this branch)
**Caught by:** Codex stop-time review (three rounds)
**What happened:** Fixing finding 5.11 I relabelled a screener row "Messages so far:" →
"Total ever:". Codex flagged the completeness claim. I changed it to "seen", reasoning
from two write paths that the counter was monotonic. Codex rejected that: I had never
looked for a third writer — `SendersCounterReconciliationWorker` recounts
`total_received` from `mail_messages` **nightly** and corrects drift downward. I changed
it to "indexed". Codex rejected again: files still carried false data-contract claims,
including "lifetime" in the header of the very module I had just written to fix this
class. Only then did I open `docs/adr/0014-senders-total-received-counter.md`, whose
§Neutral says: _"`total_received` is 'within retention,' not 'all-time in Gmail.' UI copy
says 'received,' never 'all-time.'"_ **The word was decided before I started.** The
pre-existing "Total ever" labels were ADR violations that had shipped.
Same pass, same shape, twice more: the new preview copy claimed the missing mail was
"already archived or deleted" (names a destination nothing checks — 19 SPAM + 1 TRASH of
2,025 measured, and any snoozed sender mislabelled). Corrected to "have already moved out
of it" — **also false**, because it asserts a TRANSITION and `mail_messages` keeps only
current `label_ids`, no history. A Gmail "Skip the Inbox" filter gives arrivals > 0 and
INBOX = 0 with nothing ever entering the inbox, and that is the real cause on the reported
sender: 71 arrivals, **71/71 UNREAD** under a custom label. I would have told the founder
"you archived these" about mail he never saw. Final copy states both observed facts and no
transition: "…in your inbox right now — though 71 arrived in the last 30 days."
**Correct approach:** CLAUDE.md §3 puts ADRs ABOVE codebase conventions and agent
judgment. When a field's meaning is load-bearing for user copy, the ADR that introduced
it is the first place to look, not the last. `ls docs/adr | grep -i <field>` would have
ended this in one step — `0014-senders-total-received-counter.md` is named after the
column. I instead read the schema comment (wrong), then the write paths (incomplete),
then measured the DB (right but silent on vocabulary), and generalized from each.
**Rule:** Before naming a derived/denormalized field in user-facing copy: (1) check
`docs/adr/` for an ADR named after it — the wording may already be decided; (2) enumerate
every writer; (3) verify against the live DB. And when copy explains a DIFFERENCE between
two counts, state only the counts: any cause ("archived", "deleted") or transition
("moved out of", "no longer in") is a claim about history, and a schema that stores only
current state can never support one. Grep the table for a history column before writing a
past-tense verb.
**Enforcement update:** `senders.ts` comment now cites ADR-0014 §Neutral explicitly.
`screener-screen.test.tsx` asserts
`not.toMatch(/total ever|all[- ]time|\bever\b|messages (seen|indexed)/i)` — banning both
words I wrongly reached for plus the ADR-forbidden ones. Finding 7 in
`docs/execution/action-surface-findings-2026-07-26.md` records the ADR quote, the
write-path evidence, and the 0-drift measurement.

## 2026-07-27 — Traded a true hedge for a false absolute while fixing a truth bug
**PR:** (this branch)
**Caught by:** Codex stop-time review
**What happened:** Fixing finding 5.11 (screener showing an all-labels count beside an
INBOX-now preview — I wrongly described it as "lifetime" at the time) I relabelled the row
from "Messages so far:" to "Total ever:". The
scope disambiguation was right; the word was not. `senders.total_received` is monotonic
over what DeclutrMail has OBSERVED — `handleMessageDeleted` hard-deletes the
`mail_messages` row without decrementing it (so it counts mail that no longer exists,
including mail DeclutrMail's own Delete removed), and Gmail purges Trash/Spam before a
mailbox is ever connected. The ORIGINAL "so far" was the honest hedge. I replaced a true
statement with a false one, in the very session whose purpose was eliminating surfaces
that assert what the system does not know. Three pre-existing siblings made the same
claim ("Total ever" ×2, "N ever" ×1) and were corrected in the same pass.
**Correct approach:** When relabelling for scope, change ONLY the axis that was
ambiguous. "Messages so far" was under-specified on LABEL scope (all-labels vs inbox);
it was already correct on TIME scope. Fixing one axis must not silently strengthen the
other. Before writing an absolute ("ever", "all", "total", "every"), find the write path
and ask what makes the counter go down — if nothing does, it is a monotonic observation,
not a total.
**Rule:** A completeness word on a denormalized counter must be justified from its write
path, not its column name. **SUPERSEDED by the entry above** — this entry's replacement
("seen") was also wrong, and the whole question had already been decided in ADR-0014
§Neutral. Check the ADR first.
**Enforcement update:** `screener-screen.test.tsx` now asserts
`expect(html).not.toMatch(/Total ever|all[- ]time/i)` on the row, so the claim cannot
come back. Finding 7 in `docs/execution/action-surface-findings-2026-07-26.md` records
the write-path evidence. NOTE: the schema comment at
`packages/db/src/schema/senders.ts:106` still says "ever" — left as-is (not user-facing)
but it is what misled this change.

## 2026-07-27 — Shipped a "trust" feature that stated a false age, and a wire change that could crash the modal
**PR:** (this branch, items B and C)
**Caught by:** Codex stop-time review
**What happened:** Two defects in the same pass, both in features whose stated purpose was
establishing trust.
(1) **B** explained a tied window chip row with "this sender's newest inbox email is N
days old", sourcing N from `compositePreview.sender.lastSeenDays`. That field is
`senders.last_seen_at` — newest message across **all labels**. Measured on the dev
mailbox: `jobs-noreply@linkedin.com` reported lastSeenDays **3** while its newest INBOX
message was **2,784** days old; `tcs.com` 4,539 vs 20,662. The copy would have printed a
confident 3-day age about a seven-year-old inbox. Fixed by deriving the age from
`recentSubjects.all[0].date`, which the server orders `internal_date DESC` over the
INBOX-scoped predicate and is therefore the newest inbox message by construction.
(2) **C** swapped the preview sample's wire shape from `string[]` to `{subject,date}[]`.
`apps/api` deploys to Cloud Run and `apps/web` to Vercel **independently**, so an
API-first deploy would have served objects to a reader that renders them as React
children — which throws, taking down the D226 confirm modal on the live site.
**I then fixed the wrong direction.** My first fix added a normalizer to the FE, which
only helps a NEW bundle read an OLD API. The bundle at risk is the one ALREADY deployed;
it will never have my normalizer. Codex had to say "still unsafe during an API-first
deploy" before I saw it. Correct fix: the API keeps emitting the legacy `recentSubjects`
alongside the new `recentMessages`, projected from the same rows.
**Correct approach:** (1) The all-labels/INBOX-now split is the exact distinction this
whole branch exists to fix. I introduced a fourth instance of it while fixing the first
three, because `lastSeenDays` was the convenient field already on the DTO. Convenience is
how this class propagates — before using a count or date in copy, name its scope out loud
and check it matches the sentence. (2) A wire-shape change between independently deployed
services needs a reader that accepts both shapes, or it is a scheduled outage.
**Rule:** Any figure placed in copy next to an INBOX-scoped number must itself be
INBOX-scoped, or be labelled with its own scope. And for a wire change between
independently deployed services, enumerate all FOUR combinations (old/new client ×
old/new server) before calling it safe — a change to the CLIENT can only ever fix the two
rows where the client is new. Protecting the already-deployed client is the SERVER's job:
keep emitting the old shape until no deployed bundle reads it.
**Enforcement update:** `normalizePreviewMessages` (`apps/web/src/lib/api/actions.ts`)
absorbs `string | {subject,date}` at the single boundary the preview enters through, with
5 tests covering both shapes, bad dates and non-arrays; the FE type is `date: string |
null` so a missing date renders as no date. The B test now sets
`sender.lastSeenDays` to a value that CONTRADICTS the inbox sample, so re-reading the
wrong field fails the assertion.

## 2026-07-28 — Smoke ran against another checkout's dev API and read stale wire shapes
**PR:** feat/d226-delete-scope-archived (pre-PR)
**Caught by:** manual test (reach chips absent from a modal the code demonstrably renders)
**What happened:** The ADR-0028 live smoke opened the Delete modal and saw no reach
chips and no `recentMessages`/`allMail` on the preview wire — code that was green in
tests. The API on :4000 was an ORPHANED process (ppid 1) from the merged d162 session's
worktree (`wt-feat-d162-email-brand-polish/apps/api`), serving that branch's build; this
session's `dev-up.sh` API had lost the port race and died silently, while its log still
ended in "successfully started". The command line gave no hint — it read
`node … src/main.ts` with an env-file path pointing at the MAIN checkout.
**Correct approach:** Before trusting any smoke, verify the serving process, not just
the port: `lsof -ti :4000 -sTCP:LISTEN | xargs -I{} lsof -p {} | grep cwd` must show
THIS checkout. Sibling of the 2026-07-26 "gh pr close switches checkout" trap — that one
was the wrong branch under your feet, this one is the wrong checkout behind your port.
**Rule:** A smoke is invalid until the server's cwd is confirmed to be the checkout
under test.
**Enforcement update:** none yet — recurs ⇒ add a cwd check to scripts/dev-up.sh.

## 2026-07-28 — Undo semantics keyed on a rollback-mutable column instead of the durable payload
**PR:** #407 (fixed in dae32112 before merge)
**Caught by:** Codex stop-time review
**What happened:** ADR-0028's reverse path decided the inbox/archive undo split from
`action_jobs.reach`. A migration rollback + re-apply resets that column to its default
on EVERY historical row, so a past all-mail Delete's undo would have taken the uniform
`+INBOX` reverse and dumped the whole archived set into the inbox. The damaged-payload
fallback ("pre-ADR behavior") did the same flood by design — for an all-mail set,
"pre-ADR behavior" IS the dangerous direction.
**Correct approach:** Safety-critical reverse semantics must live in the artifact that
is written once and survives schema churn — the undo-journal payload — and the payload
must self-describe (`reach` beside `inboxMessageIds`). Columns are at most downgrade
signals. When a signal says all-mail but the split is unreadable, fail toward the
archive (degraded, findable), never toward the flood.
**Rule:** Undo/rollback paths may only depend on write-once artifacts; ask of every
input "what does a migration rollback + re-apply do to this?"
**Enforcement update:** decision table + all three branches locked by worker tests
(split-with-corrupted-column, degrade, legacy); rollback file documents the invariant.

## 2026-07-29 — Regenerating a claims surface without checking it against its source
**PR:** #435
**Caught by:** Codex stop-time review
**What happened:** The public `/changelog` was 19 days and 112 PRs stale, so it was
regenerated from `git log`. The regeneration shipped two defects. (1) OMISSION — it
covered 2026-07-17 onward and silently dropped 07-14..07-21, which held the period's
biggest releases: self-serve plan changes (#367), the Paddle attribution repair that
made purchases land at all (#362), the D245 contract that retired VIP (#332), and the
public site itself (#325). (2) BACKDATING — one entry grouped five PRs and took its
date from the earliest member, so #374 (merged 07-24) and #373 (07-23) read as having
shipped up to two days early. Typecheck, lint, the unit tests and every CI gate were
green on both. A later sweep found eight MORE uncited merges in the three pre-existing
entries, so the defect predated this session.
**Correct approach:** A surface that makes claims about a source of truth needs a check
that compares it to that source. Reading git by hand and transcribing is the same
unverified-transcription class as a hand-maintained counter — it drifts silently and
looks complete. Group entries by the true event date; grouping by the earliest member
backdates every other member.
**Rule:** When a surface asserts facts derived from another system, ship the diff check
with it — and prove the check FAILS on the defect it was written for before trusting it.
**Enforcement update:** `scripts/check-changelog.ts` + `pnpm check-changelog` — walks
first-parent merges since the oldest entry, fails on any uncited product merge and on
any evidence commit whose merge date differs from its entry's date. Verified failing on
both reintroduced defects. Infra filtered by type AND scope; judged-internal merges are
listed by number with a reason and printed on success, so a suppression cannot read as
coverage. CI wiring deferred to its own PR (workflow-scope merge quirk).

## 2026-07-29 — Shipping a guard that passes when it cannot see its subject
**PR:** #435 (same session as the entry above)
**Caught by:** Codex stop-time review — "the changelog data is repaired, but the new guard is not ship-safe"
**What happened:** The enforcement written for the entry above — `check-changelog.ts` — was
verified against the two defects it was written for, and that was mistaken for verifying the
guard. It was blind in the case that matters. Every check ran OVER the git merge walk, so an
empty walk made all of them vacuously clean and the script printed `✓ covers every product
merge ... (0 merges walked)` and exited 0. `actions/checkout@v7` sets no `fetch-depth`
anywhere in ci.yml and therefore defaults to depth 1, so wiring it into CI — the follow-up
the same PR proposed — would have produced a permanently green, permanently blind gate. That
is the FOURTH instance of this class here: the dependency-free healthz probe with an uptime
check pointed at it, pr-merged.yml's push that branch protection rejected on every run,
verify-d recording verifications it never executed, and now this. Three further defects came
out of the same pass: local-timezone dates (`--date=short` + `--since` are both local, so an
entry-date equality check passes for the author in PDT and fails on a UTC runner), cited
commits never checked for existence or PR ownership on a page whose whole claim is that its
receipts are real, and a matcher built by string-splicing one regex's `.source` into another.
**Correct approach:** Proving a check catches the bug it was written for is necessary and not
sufficient. The question that finds this class is "what does this do when it can see
NOTHING?" — because every filter over an empty collection is clean, and clean prints green. A
check whose subject is invisible must fail closed, and must say why.
**Rule:** For any new guard, test the blind case before the positive case: starve it of its
input and require exit 1. If it goes green, it is a green light, not a guard.
**Enforcement update:** `check-changelog.ts` now refuses on a shallow repository (naming the
`fetch-depth: 0` fix), on an empty walk, and on a walk that does not reach the oldest entry it
claims to cover; all git calls pinned to `TZ=UTC`; every cited commit must resolve and belong
to its stated PR. Wired into lint-staged keyed on `changelog-content.ts` so it cannot rot
unrun; `sh .husky/pre-commit` smoked to exit 1 on a backdated entry and 0 on a clean one. All
five failure modes verified firing. CI wiring must add `fetch-depth: 0` in the same PR.

## 2026-07-29 — Reading a guard's exit code instead of its message
**PR:** #435 (third review round, same session)
**Caught by:** Codex stop-time review — "the new receipt-to-PR validation is nonfunctional"
**What happened:** The receipt-to-PR check added by the entry above never executed a single
comparison. Both git-log call sites carried their own `--pretty` string and their own
`.split()`, each holding a raw U+0001 byte — invisible in an editor, in a diff, and in review.
One lost its separator in an edit and became `--pretty=%h%s` with `line.split('')`; splitting
on the empty string yields single CHARACTERS, so the map was keyed `'8' -> '4'`, every
`.get(sha)` returned undefined, and an `if (!subject) return false` guard swallowed it.
**And I had recorded it as verified.** The fixture — a receipt filed under PR #999 — did exit
1, but because the OMISSION check caught the now-orphaned #367, not because the receipt check
fired. I asserted on the exit code and never read the message. So the previous entry's own
lesson ("prove the mechanism, not the outcome") was violated one commit after writing it, at
the next level down.
**Correct approach:** A pass/fail assertion is not enough when several checks share a fixture —
a neighbouring check will happily fail for you and look like proof. Assert on the specific
message, and design each fixture so only ONE check can produce it. Separately: two places that
must agree on an invisible delimiter will eventually disagree; the fix is one place, not two
careful ones. Never put raw control bytes in source — `%x01` and `` are both plain ASCII.
**Rule:** Test a guard by the message it prints, not the code it exits with — and never let a
delimiter live in two places or as an invisible byte.
**Enforcement update:** `logFields(revArgs, fields)` builds the format and splits in ONE place
and exits 1 if a row does not split into the requested arity; zero raw control bytes remain in
the file. All six failure modes re-proven asserting on message text, including a new case the
old code also missed (a receipt pointing at a different PR's real sha). `sh .husky/pre-commit`
re-smoked 1/0.

## 2026-07-29 — A check with a scheduled, silent death (abbreviated-sha coupling)
**PR:** #435 (fourth review round, same session)
**Caught by:** Codex stop-time review — "the repaired receipt check can still silently skip every comparison"
**What happened:** After repairing the receipt-to-PR check so it *ran*, it was still keyed on
`%h` — whose width git AUTO-SCALES from repository size (`core.abbrev` unset = auto). The
changelog cites fixed 8-character shas. The day git decides on 9, every `.get(sha)` misses.
Forcing the width proved it on the same fixture: at `core.abbrev=8` a wrong-PR receipt was
reported; at `core.abbrev=12` the receipt error vanished entirely and only the neighbouring
omission check fired. So the check was correct on the day it shipped and scheduled to go dark
a few hundred commits later, announcing nothing. What made that fatal rather than noisy was
`if (!subject) return false` — could-not-look-this-up scoring as verified-fine. The BACKDATING
check had the identical shape (`mergeDateBySha.get()`, unknown sha silently skipped) and died
at the same widths, so it was a class, not an instance.
**Correct approach:** Never join on a value whose FORMAT is chosen at runtime by something
else — an abbreviation, a truncation, a locale-formatted date. Join on the full, stable
identity. And a lookup that misses must fail, never fall through to a pass: the question to ask
of every `.get()`/`find()`/`??` in verification code is "if this misses, do I report a problem
or report success?" Test guards against the ENVIRONMENT drifting, not just the data — force the
knob (`core.abbrev`, `TZ`, locale, clone depth) and re-run.
**Rule:** In verification code, join on full identities and make every failed lookup an error;
prove it by forcing the runtime knob, not just by mutating the input.
**Enforcement update:** `resolveReceipts()` resolves each cited abbreviation to its full 40-char
sha via `cat-file --batch-check`, joins on that, and returns commit + merge date + subject or
exits 1. The date check now reads those resolved receipts instead of a window lookup, which also
removed its "older than the walked window" skip. Verified at `core.abbrev` 8/9/12/20: both a
wrong-PR receipt and a backdated entry report at EVERY width, and a clean tree passes at every
width. Grep-swept the file for residual silent-skip shapes; one `.get()` remains and it exits 1.

## 2026-07-31 — Called a launch blocker off the wrong column

**PR:** #450 (the claim), corrected in the follow-up PR
**Caught by:** Codex stop-review
**What happened:** driving matrix H2 I saw `cancel_at_period_end` flip from `t` to `f` after a replayed renewal, concluded "a refunded customer keeps Pro forever", and published it as a launch blocker in FOUNDER-FOLLOWUPS, the matrix, MISTAKES.md and a merged PR — then told the founder to block a production purchase on it. I never checked `entitlement_ends_at`, which is the column the tier recompute actually reads. It survives. Pushing the deadline past after the replay dropped the workspace to `free`: the refund verdict was enforced the whole time.

The review's objection was not "you read the wrong column" — it was that my proposed fix (make `cancel_source` sticky so it protects `cancel_at_period_end`) could not stop Paddle renewing. Chasing why that was true is what exposed the misdiagnosis: no local column stops Paddle billing, because the webhook service is a projector with no provider adapters at all.

**Correct approach:** before naming a defect, find the column the OUTCOME depends on and assert on that. I asserted on the flag whose name matched my hypothesis. And a severity label is a claim like any other — "launch blocker" needed the end-to-end demonstration (deadline passes → tier drops or does not), which takes one more step and would have refuted it.

**Rule:** trace a money claim to the value that actually gates the money, and demonstrate the end state, before assigning severity. A flag that reads like the thing you are testing is not evidence that it governs it.

**Enforcement update:** none — same family as the BLIND-GUARD rule below (a check that appears to verify and does not). Third occurrence in this session; a CLAUDE.md §8 line is now warranted if it recurs.

## 2026-07-31 — Two "verifications" that verified nothing, in one session

**PR:** #448
**Caught by:** negative controls (running each test with its fix reverted)
**What happened:** (1) A race test written to prove the un-cancel's ordering marker worked PASSED with the fix reverted — the pre-existing cancel marker refused the stale event on its own, so the new code path was never exercised. (2) Restoring that same one-line fix with a `python` string replace silently didn't match, and the check `"cancellation_revoked" in source` returned true by matching the COMMENT written moments earlier.
**Correct approach:** a test that has never been observed to fail proves nothing. Run every new guard's negative control before trusting it, and grep the actual code construct — not a substring that prose can satisfy.
**Rule:** before trusting a green test, revert its fix and watch it go red. Verify edits with a pattern only the code can match (`rg` the SQL/expression), never one a comment could.
**Enforcement update:** none — this is the existing BLIND-GUARD rule (LEARNINGS, ui-truth bug class) recurring for the third time. Candidate for a CLAUDE.md §8 line if it appears again.

## 2026-07-31 — Automatic pageview capture switched on inside a billing PR

**PR:** #452 (`b606e0f4` — "fix(billing): Stop refunds diverging from Paddle (D118, D121)")
**Caught by:** founder, reading the PostHog dashboards weeks later
**What happened:** `capture_pageview: false` became `capture_pageview: 'history_change'` in a pull request whose title, scope and D-refs were entirely about refund reconciliation. That one line changes what the product sends about every visitor on every route — `$pageview` carries `$current_url`, so the full address bar started going to a third party automatically, outside any `track()` call. No reviewer reading "Stop refunds diverging from Paddle (D118, D121)" has a reason to look for it, and no gate fires on it: the change is three tokens, typechecks, and every test passes.

It was not a harmless default flip either. Turning on `$pageview` is what put raw URLs on the wire, which is the leak #454 then had to fix — and the `/flags/` variant found the same day. The privacy defect and the packaging mistake are the same event.

**Correct approach:** a change to WHAT TELEMETRY LEAVES THE BROWSER is its own PR, with its own title, whatever else is in the branch. If it rides along, it ships unreviewed by construction — the title is the only signal a reviewer gets about where to look.

**Rule:** telemetry-capture switches (`capture_pageview`, `capture_pageleave`, `autocapture`, `session_recording`, any `advanced_disable_*`) never ride in a PR about something else. Own PR, D-ref, and a stated reason.

**Enforcement update:** none yet. A hook that fails when `apps/web/src/lib/posthog.ts` init options change in a PR whose title has no observability/privacy scope would catch the whole class — candidate if it recurs.

## 2026-07-31 — Closed one door to PostHog, shipped with the other open

**PR:** #454 (the fix that was incomplete), found post-merge by local smoke
**Caught by:** smoke against a local echo server standing in for PostHog's ingest endpoint
**What happened:** #454 stripped query strings, fragments and userinfo from telemetry URLs, verified by unit tests and by me against `scrubTelemetryPayload` directly. It was wired through `sanitize_properties` — which posthog-js applies to CAPTURED EVENTS ONLY. The SDK also POSTs to `/flags/`, carrying its own `person_properties`, and that request never passes through the hook. So `$initial_current_url` and `$initial_utm_content` went out with the raw address bar in them — `?sender_q=<address>` included — while `/e/` in the very same session was provably clean. One endpoint fixed, one endpoint leaking, same defect, same page load.

Nothing in the PR was wrong; the scope was. The question asked was "does the scrubber scrub?" when it should have been "what else talks to PostHog?".

**Correct approach:** when a fix hangs off a vendor SDK hook, enumerate every request that SDK makes and check which ones the hook actually covers. Assert on the wire, not on the function — the function was correct in isolation the whole time.

**Rule:** verify a telemetry fix by reading what leaves the browser, not by unit-testing the scrubber. Point the SDK at a local echo server and diff every endpoint it hits.

**Enforcement update:** `advanced_disable_flags: true` removes the endpoint rather than scrubbing it — a door that does not exist cannot be reopened by an SDK upgrade. The general rule stays manual.

## 2026-08-04 — Rollback that re-armed stale unattended Autopilot actions

**PR:** #465
**Caught by:** Codex stop-time review (after the schema gate passed it as an [INFO])
**What happened:** 0053's rollback restored every entitlement-dismissed
match to its bit-exact pre-demotion tuple — `(resolution='approved',
intent_applied=false)`. A "perfect" restore, and exactly the hazard the
D251 demotion exists to kill: on any workspace holding (or later
regaining) `autopilot-active`, the next action sweep would EXECUTE those
months-stale matches unattended. The reconciliation sweep only
re-dismisses under-entitled tiers, so an entitled workspace had no
safety net. The schema gate even praised the fidelity ("bit-exact — not
an approximation") — restoration accuracy and restoration safety are
different properties.
**Correct approach:** the 0045 precedent — documented `SELECT 1;` no-op.
The enum label stays (Postgres can't drop it; readers allowlist), and
reversing a specific workspace's demotion is a hand-verified support
operation, never a blanket migration statement. 0050 shows the only
acceptable direction for data writes in a rollback: DISARM side effects
(expire tokens, fail jobs, clear id sets) — never re-arm them.
**Rule:** a migration rollback reverts schema. Any data statement in a
rollback must reduce the system's ability to mutate user data, never
restore it. If a rollback would make mail-moving work executable again,
it is wrong regardless of how faithfully it restores prior state.
**Enforcement update:** none yet — candidate roundtrip-test assertion:
rollback files may not UPDATE rows into states the workers treat as
executable (`resolution='approved' AND intent_applied=false`).

## 2026-08-04 — One downgrade sentence, five false absolutes in a row

**PR:** #465
**Caught by:** Codex stop-time review, five consecutive rounds on the
same rule-card string
**What happened:** the Plus-facing explanation for a leftover Active
rule shipped five absolutes in sequence, each replacing the last:
(1) "its collected matches keep waiting for your approval" — false,
the demotion dismisses them; (2) "matches …are cleared" — false, a
match already mid-action is untouched; (3) "finishes, with its normal
undo" — false for an Unsubscribe rule, whose delivered request is
one-way (D58); (4) "still completes" — false again, an in-flight
request can FAIL at the sender's endpoint; (5) "its result lands in
Activity" — false again: Activity's execution lineages cover only
archive/later/delete (EXECUTION_VERBS), and no-op terminals write no
row, so a failed or skipped unsubscribe surfaces nowhere. Every fix answered the
previous objection with a new unqualified claim instead of asking what
holds for EVERY verb and EVERY outcome the sentence covers. The
settled form claims only what the system guarantees: in-flight work is
not interrupted, and mail that actually moves keeps its Activity
record (and, for label verbs, its undo).
**Correct approach:** copy describing automated mail movement is a
claim over a state space (verb × match lifecycle). Enumerate it before
writing: unapplied/dismissed, in-flight, applied — and per verb, since
unsubscribe is one-way while label verbs undo. The final copy branches
on `rule.actionKind` and states only per-branch facts, with a test
driving both branches.
**Rule:** never ship an absolute ("all", "cleared", "keeps",
"completes", "with undo") in automation copy without walking the
verb × lifecycle × OUTCOME matrix — outcomes include failure; any undo
claim adjacent to unsubscribe must name the one-way boundary in the
same breath (the ACTION_SAFETY_SUMMARY discipline applies to per-rule
strings too).
**Enforcement update:** screen test now pins the per-verb branches and
rejects the three failed absolutes.

## 2026-08-04 — A proximity heuristic in a hook: seven rounds, seven holes
**PR:** feat/d250-ship-remaining-copy-rows (this branch)
**Caught by:** Codex stop-time review, seven consecutive rounds
**What happened:** ADR-0030 records that the copy-spec truth constraints
were not hook-enforced, so `check-microcopy.sh` gained rules for T2, T3,
T5 and T6. T2/T5/T6 match fixed strings and have needed no correction
since the first round. T3 — "does this sentence attribute blocking to the
Screener" — needs PROXIMITY, and failed in a new place every round:
line-wrapped phrases; a window crossing code structure; a closed verb list
that dropped `quarantining`; a case-sensitivity flag `${4:-i}` silently
ignored (the mechanism the commit message credited was never running);
inline markup bounding the window; the inline tag set enumerated when the
block set was the closed one; and finally hyphenated custom elements and
attributes containing `>`. Rounds three onward were all fixes to fixes.
Each patch also re-introduced a defect on the other side — narrowing to
kill false positives cost recall, widening to restore recall brought them
back.
**Correct approach:** T3 was removed and returned to the copy spec's
review brief, where T1, T4 and T7 already sit for exactly this reason.
The normalisation it motivated (comment stripping, whitespace flattening,
markup and interpolation removal) was kept, because T2/T5/T6 genuinely
need it — a ban must not escape by having `<Text>` or `{tier}` dropped
into the middle of it.
**Rule:** a hook may enforce a constraint that is a STRING. A constraint
that needs a window — proximity, distance, "near", "in the same sentence"
— is a reading, not a match; route it to review instead. The tell is the
second fix-to-a-fix: if narrowing costs recall and widening costs
precision, the window has no correct width.
**Enforcement update:** T3 matcher deleted from
`.claude/hooks/check-microcopy.sh`, replaced with a comment recording why
and pointing at the review brief. D194's forbidden framings remain binding
on copy; they are checked by review.
