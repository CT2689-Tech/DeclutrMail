# Claude takeover — draft PR 325

Date: 2026-07-13

Branch: `feat/d132-public-product-site`

PR: <https://github.com/CT2689-Tech/DeclutrMail/pull/325>

This is the operational pickup note. The complete Gmail-native friction
inventory, product critique, shipped responses, and founder blockers live in
`docs/execution/product-experience-audit-2026-07-12.md`. D-decision deviations
and rollback ownership live in `docs/execution/d-break-ledger-2026-07-11.md`.

## Pickup state

- Keep this PR draft until the founder/operations gates below are resolved or
  explicitly waived.
- Continue on the same branch in small conventional commits; do not squash the
  behavioral boundaries before review.
- The exact code/documentation head and final smoke evidence are recorded in
  the PR's `Claude handoff` section and the reconciled audit.
- Browser telemetry is deny-by-default and lazy-only. Do not reintroduce direct
  CSP `report-uri`, default Sentry integrations, automatic breadcrumbs, raw
  exception text, request/user context, or capability/job identifiers.

## Remaining release work

| Priority | Owner                 | Gate                                                                                                                                   | Next evidence/action                                                                       |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P0       | Founder               | Ratify the “exact” privacy contract against ADR-0004/ADR-0021 and the actual schema                                                    | One accepted D-decision plus synchronized locked copy                                      |
| P0       | Founder               | Resolve D126 `$149/year` versus the tier manifest `$190/year`                                                                          | One canonical manifest/decision and pricing regression                                     |
| P0       | Founder + billing ops | Paid catalog IDs are absent and deploy sets `BILLING_ENABLED=false`                                                                    | Configure sandbox catalog, enable intentionally, verify checkout/webhook/cancel/refund     |
| P0       | Founder + platform    | Choose apex versus `app` canonical host; redeploy the corrected CORS value; restore D193 API `--min-instances=1`                       | Production redirect/CORS/cold-start smoke with redacted evidence                           |
| P0       | Security/ops          | Live OAuth/CASA, two-account Gmail round trip, support/privacy mailboxes, and current CASA letter are not repository-provable          | Run the live launch checklist without committing credentials or mailbox content            |
| P0       | Backend observability | Server, edge, and API Sentry still need a deny-by-default policy; dead-letter persistence/alerts can retain raw error text and job IDs | Implement the sequence below and add leak-marker wire tests                                |
| P1       | Product               | Strict initial sync still blocks the useful shell                                                                                      | Test a read-only progressive shell and record the D6 decision                              |
| P1       | Product/design        | Validate the first-value loop with real activation data                                                                                | Connect → sync → practice → real preview → receipt → mailbox-bound Gmail round trip        |
| P1       | Design systems        | Compact row/card errors, PageShell/PageHeader widths, and the broader 390/768/1440 authenticated sweep remain                          | Add an inline recovery primitive; do not put full-screen alert panels inside compact cards |
| P1       | Data/product          | `rule_fired`, `unsubscribe_attempted`, and `billing_event` have no consent-aware terminal sink                                         | Wire outcome events, publish a metric dictionary, then build funnels                       |

## Next engineering sequence

1. Finish server/edge/API telemetry parity before adding diagnostics:
   - explicit false `dataCollection` fields;
   - callback-form integration allowlists so future defaults fail closed;
   - a server event sanitizer that drops request/user/context/exception text,
     locals, context lines, arbitrary tags/extras, and raw identifiers;
   - safe route template/method/status/kind plus validated correlation UUID and
     canonical source-map coordinates only;
   - API keeps `defaultIntegrations: false`.
2. Harden dead letters and remaining worker-specific catches:
   - persist error class/code plus a safe digest/trusted frame, not raw
     message/stack;
   - never log or alert on original BullMQ IDs or replay idempotency values;
   - regression markers must cover undo tokens, OAuth codes, emails, provider
     response bodies, and alphanumeric secrets in both keys and values.
3. Complete founder/platform gates, then run live OAuth, multi-account Gmail,
   billing, webhook, CORS, and warm-instance acceptance.
4. Use observed first-value drop-off to choose the next product slice; do not
   optimize from route count or projected “messages prevented.”

## Validation baseline for any follow-up

```bash
/opt/homebrew/bin/pnpm typecheck
/opt/homebrew/bin/pnpm lint
/opt/homebrew/bin/pnpm format:check
/opt/homebrew/bin/pnpm test
/opt/homebrew/bin/pnpm build
git diff --check
gh pr checks 325 --repo CT2689-Tech/DeclutrMail
```

For a telemetry change, also run focused shared/web/API/worker policy tests and
assert the resolved Sentry integration names and resolved `dataCollection`
object, not just source configuration.

## Rollback

- Review the branch by commit; each behavioral unit is intentionally small.
- If work is split into separate merged PRs, record each PR in the D-break
  ledger and run `scripts/revert-pr.sh <PR_NUMBER> --push`.
- Inside this single unmerged draft, use an intentional `git revert <SHA>` for
  one unit. The PR-number script cannot independently identify commits that
  were merged together as one PR.

## Suggested skills for the next session

- `cavecrew` for bounded investigator/builder/reviewer delegation.
- `github:gh-fix-ci` if a required Actions check fails.
- `browser:control-in-app-browser` for the exact responsive acceptance pass.
- `diagnose` for any reproducible regression; preserve the red/green evidence.
