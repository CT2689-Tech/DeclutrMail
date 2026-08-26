# ADR-0037: One window for a sender's activity

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** founder, Claude
- **Related D-decisions:** D7, D21, D39, D245

## Context

A user opened /triage and found one card asserting two things at once:

> Bank of America's alerts are arriving at high volume (60 messages
> monthly) but are almost never read (1% read rate)

printed directly under

> 0% read in 90d · 209 messages

Both halves were correct. They disagreed because they were computed from
different sources, over different windows, at different times.

Investigating produced a wider finding: **the same named fact was derived
independently at four call sites, from three sources, over three
windows** — and the wire field name was identical at every one of them,
so the divergence was invisible at the type level.

`monthlyVolume` meant, simultaneously:

| Site                      | Definition            | Source                     |
| ------------------------- | --------------------- | -------------------------- |
| `senders.read-service`    | rolling **30d** count | `mail_messages`            |
| `triage.read-service`     | `round(last90 / 3)`   | `mail_messages`            |
| `score.worker`            | `volume90 / 3`        | `sender_timeseries`        |
| `activity.read-service`   | `round(last90 / 3)`   | `mail_messages` (own copy) |
| `senders.types` docstring | latest month's bucket | stale prose                |

`readRate` meant four things too — 30-day, 90-day and lifetime variants,
two of them decontaminated of third-party sweeper marks (mig 0064) and
two not.

The engine's own source carried a defect no display could reveal.
`sender_timeseries.year_month` is a DATE pinned to the first of the
month, and the worker's window was `year_month >= (now - 90 days)`. On
2026-08-19 that reads `'2026-05-01' >= '2026-05-21'` — false — so the
oldest bucket was dropped **whole** and the total was still divided by
three. Measured on the founder's mailbox: 3,977 of 14,972 messages
(26.6%) discarded on every scoring run, understating volume, and
therefore understating the case for cleanup, in a direction nothing on
screen could show.

A rolling 90-day window cannot be expressed over calendar-month buckets
at all. The window was not misconfigured; the source was the wrong shape
for the question.

## Decision

**A sender's activity has one definition: inbound messages in the last
`WINDOWS.ENGINE_WINDOW_DAYS` (90), read from `mail_messages`.**

Three rules follow.

1. **The engine and the display read the same window from the same
   table.** `sender_timeseries` is no longer read for scoring. It remains
   the source for the sparkline, which is a per-month series by nature.

2. **The evidence printed beside a recommendation is measured over the
   window that recommendation was computed from.** Senders and Sender
   Detail printed 30-day figures above a verdict produced from 90-day
   facts; on the founder's mailbox one sender read "0 in last 30d" on
   Senders and "157 messages" on Triage on the same day, both correct and
   irreconcilable to a reader. A number that did not feed the
   recommendation is not evidence for it.

3. **The read-rate numerator is decontaminated everywhere it is
   computed.** Messages a known third-party sweeper marked read are
   excluded from the numerator and kept in the denominator (the message
   did arrive). One predicate, `readStateNotSweeperMarked`, at every
   call site.

Windows that answer a **different question** keep their own span and say
so where they are shown. `volumeTrend` compares the last 30 days against
the 30–90 day period behind it, because "is this rising or falling"
needs a recent slice and a baseline; it is not the recommendation's
evidence and is not forced to 90 days.

## Alternatives considered

- **Standardise everything on 30 days.** Rejected: it discards two-thirds
  of the signal the cascade is tuned on and would require re-tuning every
  threshold in `packages/shared/src/triage-engine/cascade.ts`.
- **Keep both windows, label them clearly.** The cheapest option, and
  honest — the labels already existed. Rejected because it leaves the
  reader holding two windows in their head on the product's trust wedge,
  and because it does not address the engine reading a third source.
- **Fix the bucket comparison in place** (`year_month >= date_trunc('month', now - 90 days)`).
  Rejected: it makes the window 4 buckets some months and 3 in others
  while still dividing by three, and leaves two sources of truth.
- **Keep `sender_timeseries` as the engine's source and reconcile it
  harder.** Rejected: the reconcile already exists and the drift is
  structural, not a sync bug — monthly buckets cannot express a rolling
  window.

## Consequences

### Positive

- One definition, one source, one window for the fact the whole product
  argues from.
- The engine sees ~12% more volume on the founder's mailbox (10,995 →
  12,276 over 90 days), which is signal it always should have had.
- Triage and Senders can no longer report different read rates for the
  same sender on the same day.
- The engine's per-sender scan drops a query: the 90-day facts fold into
  the `mail_messages` aggregate that was already running.

### Negative

- **Recommendations shift toward cleanup.** 12 senders cross the
  cascade's monthly-volume ≥ 8 gate and 6 cross ≥ 30; none crosses
  downward. Every one still rides the preview-and-confirm path and none
  reaches a bulk path, but this is pressure toward a destructive verb and
  is named here rather than discovered later.
- **Displayed numbers change for every sender.** A user who learned the
  Senders screen's cadence figure sees a different, larger number. The
  label moves with it ("in last 90d"), and the `/mo` suffix the table
  printed over a 90-day count is removed — it was a threefold
  overstatement even before this change.
- `monthlyVolume` remains a misleading wire-field name for a window
  count. Renaming it is a breaking contract change across the FE and is
  deliberately not bundled here; the docstring now states what it
  actually is.

### Neutral

- The decontamination is a no-op on any mailbox whose `mailbox_labels`
  table is unpopulated (no sweeper labels registered yet), including the
  dev DB at the time of writing. The behaviour is proven by unit test
  rather than by a field delta.
