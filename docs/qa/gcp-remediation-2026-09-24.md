# GCP remediation — September 24, 2026

Implements the authorized configuration/cost audit recommendations. This record
separates applied infrastructure from code release and items requiring missing
account information. It is not a complete production or marketing sign-off.

## Applied and read back

| Area                        | Change                                                                                                                                                                             | Verification / limit                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail notification recovery | Primary subscription never expires; 10–600s retry backoff; approximately 100 attempts before forwarding to a dedicated pull-only dead-letter subscription with seven-day retention | Topic/subscription and narrowly scoped Pub/Sub service-agent grants verified. No message purge/replay. End-to-end forwarding rehearsal remains unverified.                                                            |
| Recovery monitoring         | Enabled dedicated dead-letter backlog alert, existing company-admin notification channel                                                                                           | Policy readback verified; inbox receipt not verified.                                                                                                                                                                 |
| Budget alerts               | Corrected name to `declutrmail-monthly-alert-20`; kept USD20; actual thresholds 50/90/100%, forecast 100%                                                                          | Final threshold readback verified. Alerts do not cap or shut off spending.                                                                                                                                            |
| Deployment federation       | GitHub identity requires the intended repository AND `refs/heads/main`                                                                                                             | Provider readback verified. Non-main manual cloud workflows intentionally cannot authenticate. Scheduled main workflows remain eligible.                                                                              |
| Runtime secret access       | Replaced project-wide runtime Secret Accessor with explicit access to 18 referenced secrets                                                                                        | All 393 historical revisions checked; 12 missing resource grants added, six already existed. All other bindings preserved. Health/readiness remained successful; fresh deployment also required.                      |
| Image storage               | Enabled reviewed cleanup policy: delete builds older than 30 days, keep newest20 plus all `retain-` images                                                                         | Dry-run285 candidates exactly matched independent policy evaluation; no intersection with20 retained digests. Current and previous releases rechecked/pinned. Actual deletion/savings asynchronous, not yet measured. |
| Monitoring dashboard        | Replaced obsolete “awaiting export” guidance                                                                                                                                       | Authenticated company admin opened exact dashboard; operational and available cost charts rendered. Missing sources remain unknown.                                                                                   |
| Private finance storage     | Separate `declutrmail-finance` project under existing organization/billing; private versioned bucket                                                                               | Separation avoids inherited production Cloud Build access. Admin owns project; collector has bucket metadata read, config read, and report/observation writes only. No public grants.                                 |

Secret scope narrowing protects future secrets; shared API/worker identity can still
read the current union. Splitting identities needs a separate tested deployment.
KMS behavior and runtime billing bindings were preserved.

## Code release

[PR768](https://github.com/CT2689-Tech/DeclutrMail/pull/768): authenticated unknown
mailbox notifications acknowledge terminal no-ops; database/service errors still
fail for retry, malformed requests reject, and OIDC authentication is unchanged.
Worker startup uses HTTP bootstrap readiness. The HTTP API stages without traffic,
checks health/database/Redis/auth rejection, then promotes an explicit revision;
failed promotion/smoke restores the previous traffic assignment. All production
runs share a lock and require main. API liveness uses dependency-free health.

Cost checks compare matching Pacific-month project usage and budget filters,
label a simple linear estimate, and withhold compliance when data/scope differs.
The existing daily watchdog can persist private observations/reports separately
from public operational artifacts. Invoice amounts, payments, usage, forecasts,
and currencies/account scopes are not added together.

Validation before initial PR: whole-workspace typecheck and lint passed (seven
existing lint warnings), 42 infrastructure/finance/deployment tests and39 targeted
webhook/service/health tests passed. Independent reviews caught and resolved
concurrent deployment and UTC-versus-Pacific budget-period defects. Final CI and
serving-release evidence should be read from the PR/deployment, not inferred from
these local tests.

## Finance coverage

[Private report](https://storage.cloud.google.com/declutrmail-finance-private/reports/latest.html)
requires authorized Google access. Seventeen historical records from four vendors
were recovered with their original verification timestamp and15 known payment
dates. Exact account attribution and document type were absent in the old widget,
so those rows remain unreconciled and are excluded from paid totals. Source records
are private, not committed here. Recurring prices/renewals not verified remain
unknown. Finance-project costs are explicitly separate and not covered by the
production-project export. Storage/API operations/version copies add usage costs;
no new application compute or collection schedule was introduced.

## Diagnosed blockers and unchanged items

| Item                                        | Evidence / next requirement                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anthropic production credit                 | Sentry-only encrypted diagnostics and bounded log classification confirm HTTP400 insufficient credit. Existing adapters return template fallbacks;51 related tests passed. Funding amount/payment choice belongs to the owner. Separate monitoring admin credential is also invalid. |
| Backup administrator                        | Exact company-controlled backup identity still required. No guessed user granted access.                                                                                                                                                                                             |
| Legal billing profile                       | Individual payments profile observed; intended legal entity/details required before changing it.                                                                                                                                                                                     |
| Complete finance history/future commitments | Original invoices/account attribution, missing vendors and contract/renewal terms required. Unknown does not mean zero.                                                                                                                                                              |
| Outgoing digest / notification receipt      | Destination preference and inbox access remain unresolved. No new outgoing digest or alert test message sent.                                                                                                                                                                        |
| OAuth enhancements                          | Existing verified scopes and strong signed state preserved. PKCE/incremental consent need a separate real login/reconnect rehearsal; no speculative scope expansion.                                                                                                                 |
| Worker liveness/recovery targets            | Bootstrap readiness improved. Progress-aware restart behavior and shorter crash-recovery intervals need controlled failure/cost evidence; blindly restarting on dependency outages is unsafe.                                                                                        |
| Region / scaling / connection pools         | Measure network floor and real request/pool contention before changes. Do not increase pools or relocate production solely from configuration.                                                                                                                                       |
| Paddle worker binding discrepancy           | Current worker uses billing reconciliation; API-only convention conflicts with executable architecture. Removing its key could break billing; explicit architecture resolution required. No live Paddle exploratory calls or writes.                                                 |
| Restore and provider-specific checks        | Database restore/PITR rehearsal, Redis durability/eviction and other platform audits remain separate work; no claim of complete launch readiness.                                                                                                                                    |

## Recovery references

- Gmail replay procedure: `docs/ops/observability-alerts.md`.
- API traffic rollback: deploy helper logs prior resolved revision percentages before staging. Abrupt runner termination still requires manual recovery; worker rollout is not rolled back with API traffic.
- Secret IAM emergency rollback: restore only runtime service account's project `roles/secretmanager.secretAccessor`; private before/after snapshots retained locally. Prefer fixing a missing explicit grant.
- Image cleanup: return the existing policy to dry-run to stop future cleanup; already deleted older images cannot be restored by that switch. Keep serving/rollback tags.
- Finance: clear `PRIVATE_FINANCE_BUCKET` repository variable to stop report updates; retain private source records/versioned reports. Never make the bucket public to fix an access problem.
- Federation: prior condition restricted repository only. Restore that condition only for a demonstrated legitimate blocked workflow, then re-narrow; main releases should pass current policy.
