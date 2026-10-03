# Activity filter composition audit — 2026-10-03

Scope: Activity filter selection, URL persistence and revisit/recovery. Production
account R (Plus) was visibly verified; changed behavior was tested separately with
an isolated synthetic account. Onboarding, billing and Gmail mutations are excluded.

Before: selecting Failed and then 7 days before navigation settled dropped Failed
from the URL. A later edit copied a stale Next route snapshot. After: each edit
merges synchronously with the current browser URL; Next updates the selected
controls and client queries. Unrelated parameters and hashes remain intact.

Two meaningful regressions failed before the repair. All 116 Activity tests pass.
Scoped web typecheck, focused ESLint and formatting pass. Independent reviewer
found no blockers, including Next native-history synchronization and stale-value
readers. No provider mutation reads these filter values.

Real Next browser verification passed: rapid Failed/7 days selections, matching
chips and selected controls, Overview navigation, Back/forward, reload, subsequent
Manual selection and Clear. The isolated API served Activity requests successfully.
This proves filter composition and persistence, not a Gmail/provider outcome.

The existing design, analytics payloads and filter policy are unchanged. Broader
opportunities remain in the launch audit: accessible operational dashboards,
provider completion and restoration evidence, eligible-plan output coverage and
clearer cost-coverage labels. They are outside this bounded repair.

Integration owner: root audit session. Owned files: Activity screen and tests plus
this record. No dependencies on other audit PRs, migrations or shared contracts.
Merged, deployed and production verified must be checked separately.
