### 2026-09-28 — Waive CLAUDE.md §2.6 for #807's dormant consumer, or hold it for the redesign
**Source:** PR #807 (https://github.com/CT2689-Tech/DeclutrMail/pull/807); architecture-guardian, CONFIRMED, BLOCKING, on two consecutive gate runs
**Why:** #807's `handleNonMailPurged` awaits two BullMQ publishes while the outbox dispatcher's `FOR UPDATE SKIP LOCKED` claim transaction is still open — CLAUDE.md §2.6's named class. Both queues sit on a Redis connection that buffers commands during an outage instead of rejecting, so an outage there can hold the transaction's row locks and pooled connection well past a moment. The gate's own words: "Only the founder can waive a §2 rule, and no waiver is recorded."

What's already true, narrowing the exposure:
- The topic this consumer handles (`mailbox.non_mail_purged`) has no publisher yet — PR #791 is the only one that will ever publish it, and #791 is still open. Nothing calls this code path in production today.
- #807 bounds each of the two calls at 5s (`withPublishTimeout` in `rescore-senders.ts`), so a hung Redis fails within that bound instead of hanging forever — but the dispatcher claims up to 32 rows per tick in one transaction, and only reports failures after the whole batch resolves, so a batch that is mostly purge rows could still hold the transaction for multiple times 5s, and the failure signal for the whole batch is delayed until it does. The bound helps; it does not make the exposure small.
- The same shape (a BullMQ publish inside this same transaction, on this same connection) already exists in the pre-existing `enqueueAutopilotApply` consumer, so #807 is not the first place this pattern shipped — but the gate does not accept "already shipped elsewhere" as satisfying §2.6, and neither does this entry.
- A full fix needs the dispatcher's claim/commit boundary redesigned across every registered consumer (not just this one). That audit and fix is already running as its own task, spawned 2026-09-28, in its own worktree.

**How:** Choose one, and say which on PR #791's thread (or wherever you want the record):
1. **Waive it for #807.** Accept the bounded (5s-per-call, up-to-several-minutes-per-batch-worst-case) exposure on a topic nothing publishes yet, and let #807 merge now. The separate audit task's fix, when it lands, closes the gap for this consumer along with the others.
2. **Hold #807.** Don't merge it until the audit task's PR lands and the dispatcher no longer holds a network call inside its claim transaction for any consumer, this one included.

Either way, #791 (the actual purge, which is the only thing that will ever call this code) is unaffected: it queues after #807 regardless, and after your separate "yes drafts" confirmation on the non-mail count.
**Verifies by:** this entry's Status line. The automated gate has no way to read a waiver — it will keep reporting this finding as BLOCKING on every run regardless of which you choose, since nothing about the code changes if you pick (1). Choosing (1) means merging #807 with that gate verdict still showing BLOCKED, on your explicit say-so recorded here, not by the gate turning green. If you choose (2), the record closes once the audit task's PR merges and a gate run on #807 no longer finds the pattern.
**Status:** Open
