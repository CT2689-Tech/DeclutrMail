# Sender Classification Evaluation Set

Phase 1 of the Variant D bucketing re-design (per session 2026-05-26).

## What this is

A labeled dataset of 165 senders from the local development DB, used to evaluate
how well the existing `runCascade` decision engine (`packages/workers/src/score-cascade.ts`)
maps to the **4 user-intent buckets** the Variant D Senders surface displays:

| Bucket | What it means |
| --- | --- |
| `people` | Real correspondence — you reply, or it's Gmail Primary, or you manually flagged it |
| `engaged` | You read most of what they send — keep but not bidirectional |
| `cleanup` | Noisy senders you can let go (high volume, low read rate, no engagement) |
| `watching` | Insufficient signal yet — too new, too sparse, or genuinely middle-ground |

## Why this exists

Without ground-truth labels every threshold-tweak feels subjective. The eval set
turns "is bucketing right?" into "X of 165 rows agree with my judgment; here are
the mismatches" — a measurable signal.

## The sample (165 senders)

| Band | Count | How selected |
| --- | --- | --- |
| `top_volume` | 100 | Most messages all-time. Covers the loud half of the mailbox. |
| `important` | 15 | Replied-to / starred / Gmail IMPORTANT-labelled (not already in top_volume). |
| `random_tail` | 50 | Random sample from the long-tail (not already picked). |

Real DB had 354 senders, 1 triage_decision, 0 sender_policies. Engine sparse on
purpose — that's the cold-start state we're designing for.

## Files

| File | Purpose |
| --- | --- |
| `sender-classification-eval-set.csv` | Eval rows w/ signals + empty label columns. Edit this. |
| `regenerate-eval-set.sql` | The query that produced the CSV. Re-run when DB grows. |
| `score-eval.ts` | Loads labeled CSV → runs `runCascade` per row → emits mismatch report. |

## How to label

1. Open `sender-classification-eval-set.csv` in a spreadsheet (Numbers, Excel, Google Sheets, VS Code's CSV viewer).
2. For each row, look at the signal columns and decide what the **right** bucket is:
   - `total_messages`, `monthly_volume`, `msgs_90d`, `msgs_30d` — volume signals
   - `read_rate_90d`, `read_rate_all` — engagement signals
   - `replies_sent` — bidirectional signal
   - `starred_year`, `important_count` — explicit user signals
   - `has_unsub` — newsletter-style signal
   - `gmail_category` — Gmail's own classification (not ours)
   - `first_seen_months`, `last_seen_days` — relationship age + recency
3. Fill the **`desired_action`** column with exactly one of: `people` / `cleanup` / `engaged` / `watching`.
4. Optional: fill `desired_reason` with a short phrase (e.g. "high volume, low read", "person", "transactional but useful").
5. Optional: fill `notes` with anything ambiguous you want flagged.
6. Save the CSV.

### Labeling cheatsheet

- **person who emails you back** (1-on-1 mail, friend, colleague) → `people`
- **brand you read** (Stripe receipts, Vercel deploy emails, Slack notifications you actually read) → `engaged`
- **brand you ignore** (ICICI marketing, AJIO promos, Zerodha alerts you delete) → `cleanup`
- **occasional, mid-engagement, or new** (a service that mailed 4 times in a year) → `watching`

### Edge cases — apply judgment

- Sender with 800 msgs but 60% read → engaged, NOT cleanup. Read rate wins.
- Sender with 0 replies but Gmail Primary → people IF you'd actually want to keep, else watching.
- Sender with 2 msgs total → watching (insufficient signal), even if read rate is 100%.
- Sender you starred once 3 years ago and never read since → cleanup (one signal isn't sustained engagement).

The cascade can't read your mind — your labels are the truth set the cascade will be tuned to match.

## How to score the labels

Once you've filled at least 50 rows (more is better):

```bash
pnpm tsx docs/eval/score-eval.ts
```

The script will:
1. Parse the labeled CSV
2. For each row, construct `SenderSignals` and call `runCascade`
3. Map cascade verdict → bucket (`keep` → `people` or `engaged` based on `ruleId`)
4. Compare to your `desired_action`
5. Print a mismatch report: which senders the cascade disagreed with you on + which rule fired

## Tuning loop

1. Run `score-eval.ts` → see mismatches
2. Look at the senders the cascade got wrong + the rule that fired
3. Decide whether your label was wrong (revise CSV) OR the rule threshold is wrong
4. If rule wrong: edit `packages/workers/src/score-cascade.ts` thresholds
5. Re-run `score-eval.ts` until accuracy is "good enough" (target: ≥85% match on labeled rows)
6. Land the cascade changes in a `fix/dXX-cascade-tune-from-eval-set` PR

## Privacy posture

The CSV contains:
- Sender display name + domain (allowed per D7 — sender identity is not body content)
- Aggregate counts derived from mail metadata (msg counts, read rates, dates)

The CSV does NOT contain:
- Any message body
- Any subject line
- Any snippet
- Any attachment metadata

D7 + D228 honored. The CSV is **gitignored** because it contains real sender
domains from your dev mailbox. The infrastructure (README + regenerate SQL +
score-eval.ts) is committed; the dataset is regenerated locally:

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d declutrmail -P pager=off \
  -f docs/eval/regenerate-eval-set.sql \
  > docs/eval/sender-classification-eval-set.csv
```

Each developer / agent labels their own dev mailbox. Aggregate labels can be
shared as an anonymized rules table (separate workflow, not in this folder).
