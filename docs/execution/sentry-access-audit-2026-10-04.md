# Sentry access and asset identity audit — 2026-10-04

Relates to D7, D159, D228. Owner/integration: core-flow audit session.

## Scope and ownership

Authenticated Sentry issue inspection, fresh read-only production-event collection,
and a bounded shared-scrubber repair. Isolated `codex/sentry-asset-roundtrip` based
on `9ee071aaf39272f371273207d340b2b4c6158057`; owned files are the shared Sentry
scrubber, its existing privacy tests, and this audit. No open competing PRs at
branch creation; no dependency, schema, provider, authentication or product-policy
change. Public hydration and export investigations belong to the separate launch
holds chat and are not duplicated here.

## Current evidence

The intended Sentry organization/project is accessible in Codex's built-in browser;
the authenticated [issue feed](https://chintan-ashok-thakkar.sentry.io/issues/?project=4511517330309120),
details, source context and trace drawer render.
Read-only encrypted [workflow 37222925763](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/37222925763)
succeeded on exact main `9ee071aa` and collected production data at
`2026-10-04T18:04:01.630Z`. Eight unresolved issues occur
in the bounded seven-day search; aggregate counts are issue totals, not seven-day
incident/user rates. The temporary decryption key was removed after extracting the
approved projection. No raw messages, mailbox content or credentials enter this
tracked audit.

- [WEB-N](https://chintan-ashok-thakkar.sentry.io/issues/7638596372/): latest production sample 08:05:37Z, release `899bde43`; browser query failure,
  Screener reason visible in the issue UI. No usable filename/function mapping.
  Trace waterfall contains the error only, without diagnostic request spans.
- [WEB-2P](https://chintan-ashok-thakkar.sentry.io/issues/7769810774/) and
  [WEB-26](https://chintan-ashok-thakkar.sentry.io/issues/7717673484/): latest 07:37:31Z, release `7954ea0f`; mapped fetch call at
  `client.ts:222`. Callers are in-flight actions and Later recovery respectively.
  Simultaneous fetch rejection suggests a shared transport problem but does not
  prove offline, CORS, server outage or any specific cause.
- [WEB-2C](https://chintan-ashok-thakkar.sentry.io/issues/7742822828/): latest Oct 3 23:22:29Z, release `e96263e3`; React 418 remains with its existing
  owner. DomainIconWorker, sender-index sweep, billing reconciliation and an older
  message-less issue are historical observations requiring disposition.

No captured sample in this bounded read establishes a failure on latest `9ee071aa`;
that is not evidence that every current journey is error-free. Nothing was
resolved, archived, muted, or configured in Sentry. Fresh Cloud Run/log reads are
blocked by expired existing Google Cloud authentication; reauthentication requested.

## Reproduced repair

The scrubber accepts hashed build assets and normalizes their filenames/code_file
to `app:///_next/static/chunks/<hash>.js`. Its input regex required a hyphen or dot
before the hash, so a second browser scrub pass dropped those already-safe identities.
The old-source round-trip regression fails on the browser profile; server profile
retains its existing behavior. This is a source-confirmed observability defect,
not a proved cause of WEB-N's mapping loss or its fetch rejection.

A separate, strictly anchored canonical pattern accepts only the already-normalized
`app:` scheme without authority/query/fragment and the existing asset kind/hash/extension.
Origins, route names, nested path segments, query
strings, fragments, credentials, error messages and browser function names remain omitted.
Debug IDs/coordinates remain intact. Eight unsafe path/lookalike regressions retain
the deny-by-default boundary. No telemetry tag or data-collection expansion.

## Verification and remaining work

All 92 shared privacy tests pass, including browser/server round trips. The old
browser round-trip fails before repair. Workspace typecheck, final shared
typecheck, 45 SDK/facade/query tests, full lint (six existing warnings, no errors)
and changed-file formatter pass. Independent final privacy/security/SDK review
found no blockers and independently reran all 92 tests. Required CI and applicable
structural review are recorded in the PR when complete. No visual or product flow is
changed. Supporting mocked transport tests exercise the existing Sentry
`beforeSend` seam; they do not send a real production event or establish live
delivery/source-map resolution after release.

Still needed: current transport-failure diagnosis/reproduction and safe request
phase/operation attribution if current evidence remains insufficient; worker/log
correlation after GCP authentication; operational alert receipt; release verification.
Preserve historical failures until each has an evidence-backed disposition.
