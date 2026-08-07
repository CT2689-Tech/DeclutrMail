---
description: Capture a founder observation into FINDINGS.md, or triage the inbox
---

Capture or triage an entry in `FINDINGS.md` at the repo root.

## Argument: anything except `triage`

Append the observation to the **Inbox (untriaged)** section of
`FINDINGS.md`, then stop. Do not investigate, do not assign a priority, do
not restructure the file. Capture is meant to cost nothing — the founder is
mid-thought about something else.

Append in this shape, newest at the bottom of Inbox:

```
- **YYYY-MM-DD** · `<surface>` — <the founder's observation, their words kept>
```

`<surface>` is the route, screen, or module it was seen on — `/onboarding
step 4`, `senders detail`, `initial-sync worker`. Infer it from the
observation, a screenshot, or the current session context. If it genuinely
cannot be inferred, write `?` rather than guessing wrong.

Keep the founder's phrasing. Do not "clean up" an observation into
engineering language — the raw wording carries information about what
actually felt off.

If the Inbox is showing the `_Empty. Append here._` placeholder, replace it
with the entry.

Then reply with one line confirming the capture. Nothing more — no analysis,
no "I noticed that also relates to…". Resume whatever was in flight.

## Argument: `triage`

Work every Inbox item:

1. Read the code the observation actually touches. A verdict that could have
   been written without opening a file is not a verdict.
2. Decide whether the observation holds. It may be right, wrong, or — most
   often — pointing at something real but different from what it names. Say
   which.
3. Assign a priority: **P0** launch blocker · **P1** launch week · **P2**
   backlog · **P3** idea needing evidence.
4. Give it the next free `F###` id and move it into that section using the
   entry format already in the file (`Found` / `Observed` / `Verdict` /
   `Priority` / `Status`).
5. Cite `path:line` for anything the verdict rests on.

Items already triaged are never re-litigated unless new evidence arrived.
Nothing is deleted — `Done` and `Won't do` keep their entries.

## Argument: `status F### <new status>`

Update that entry's `Status` line only. Leave the verdict as written — the
record of what was believed at triage time is the point.
