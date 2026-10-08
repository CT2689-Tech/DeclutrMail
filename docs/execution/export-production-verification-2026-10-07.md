# Production data export verification — 2026-10-07

## Flow contract and ownership

Returning user → Settings → Privacy & data → choose selected-data JSON, Messages
CSV, Senders CSV or Decisions CSV → wait for preparation → browser download handoff
→ validate the saved artifact → return to work. Production account alias B was used
read-only after its visible Gmail identity was confirmed. The account had one
connected mailbox and 23,349 indexed messages at export time. Onboarding, billing,
deletion/expiry and mailbox mutations were excluded.

Root owns this production verification record and is the integration owner. Branch
`codex/export-flow-audit` starts at main `68900684`. No runtime source, schema,
dependency or data-collection change is proposed.

## Production identity and prior evidence

`app.declutrmail.com` resolved to READY Vercel deployment
`dpl_3MpR15Ff2tEwLtibksUSgRsWSeuz` at main `68900684383ad178ddbd4478afa4e35d853911ec`.
The API serving revision was `declutrmail-api-00556-fup` at 100% traffic.

The 2026-10-05 production attempts remain historical failures: Messages CSV and
JSON did not produce saved files on API `00533-mom`. A synthetic browser probe in
that investigation parsed 4 MiB and 8 MiB responses but failed at 24 MiB during
body consumption. The current results below do not rewrite those failures or prove
that every artifact above the current tested sizes succeeds.

## Current production results

| Format             | Saved artifact   | Validation                                                                                                                        | Database reconciliation                                                                  |
| ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Messages CSV       | 8,627,567 bytes  | Exact eight-column header, 23,349 data rows, zero malformed rows, one mailbox                                                     | Exact match to 23,349 `mail_messages` rows                                               |
| Selected-data JSON | 10,434,768 bytes | Valid `declutrmail-export-v1`; declared as a partial account export; one mailbox; expected root, mailbox, sender and message keys | Exact matches: 304 senders, 23,349 messages, 0 Activity rows and 0 product-feedback rows |
| Senders CSV        | 45,151 bytes     | Exact eleven-column header, 304 data rows, zero malformed rows                                                                    | Exact match to 304 `senders` rows                                                        |
| Decisions CSV      | 68 bytes         | Exact six-column header, zero data rows, zero malformed rows                                                                      | Exact match to zero `activity_log` rows                                                  |

All four production controls reached their existing prepared status only after the
browser finished the response blob and handed it to the download mechanism. The
four files were removed from Downloads immediately after validation. No row
contents, addresses, subjects, snippets or screenshots were committed.

The saved-file observations were at `2026-10-08T05:04:56Z` (Messages CSV),
`05:05:33Z` (JSON), `05:08:53Z` (Senders CSV) and `05:09:02Z` (Decisions CSV).
The two final small CSVs were hashed before removal: Senders
`5046fc7399215d974f5e814e1b4e5f47c3c8ecd9d98ec8d221a5466005893322` and
Decisions `ea419ceb9931afffe2aa58cd77ae4afd3140f40567f3572ec69905450d5ba2d9`.
The mailbox-bearing Messages/JSON files were deleted before the reviewer requested
hashes and were not downloaded again merely to improve the record.

## Source and regression evidence

The API keeps export queries on the explicit privacy allowlist, keyset-paginates
1,000 rows at a time and streams chunks through `StreamableFile`. The client still
calls `Response.blob()` before browser handoff, so it buffers the complete artifact.
That boundary explains why server streaming alone is not proof of arbitrarily large
browser downloads, but the present production artifacts completed successfully.

Focused regressions passed:

- API export service and controller: 16/16.
- Web export lifecycle, refresh/replay and Privacy & data view: 34/34.
- Production saved-file structure and aggregate reconciliation: all four formats passed.

Artifact validation used Python's standard `csv` and `json` parsers, exact header
and key-set comparisons, row/array counts and malformed-column counts. Read-only
database queries counted `mail_messages`, `senders`, `activity_log` and
`product_feedback` through the visibly confirmed mailbox account; no message fields
were selected.

An initial command accidentally selected the broad package suites; it was stopped
and replaced with the intended focused Vitest paths. The focused results above are
the verification evidence.

## Findings and remaining boundary

All four current product formats work at the tested production scale: one mailbox,
23,349 indexed messages and artifacts up to 10.4 MB. This does not clear the export
flow for unbounded mailbox sizes.

The client-side full-blob buffer remains a source-confirmed scaling risk, supported
by the earlier 24 MiB synthetic failure. Replacing it is not a safe one-line change:
native downloads weaken HTTP error/re-auth feedback, while incremental file writes
have browser-support and user-gesture constraints. Treat a cross-browser 25 MiB+
saved-file rehearsal as the acceptance test before choosing that design. Until that
passes or launch eligibility enforces a proven artifact limit, the larger-export
capacity path remains an open conditional launch hold. This does not recast the
current 10.4 MB production export as failed.

A durable export receipt/history could improve recovery, but it needs a defined
storage and retention policy and cannot prove the user saved a local file. It remains
an enhancement rather than part of this launch verification.
