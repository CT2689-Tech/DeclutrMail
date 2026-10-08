# HYDRATION-01 production verification — 2026-10-07

Relates to D7, D159, and D228. Owner and integration owner: current
launch-readiness session.

## Flow and boundary

This verifies the public server-render-to-client-hydration path on production for
nine representative renderers: `/`, `/pricing`, `/inbox-simulator`, `/compare`,
`/vs/unroll-me`, `/how-to/clean-gmail-by-sender`, `/security`, `/how-it-works`,
and `/faq`.

The expected outcome is HTTP 200, meaningful rendered content, no framework error
overlay, no captured hydration recovery, and correct restoration of consent and
theme. The matrix covers a first visit, a returning visitor with analytics accepted
and dark theme, and a returning essential-only visitor. Every test uses `de-DE`,
`Asia/Kolkata`, one worker, no retries, and a fresh Playwright browser context.

Production-authenticated application routes, onboarding, billing, Gmail/provider
mutation, account deletion, and deletion/expiry verification are excluded. The
authenticated companion gate on this exact source is recorded below. No product or
production configuration was changed.

## Historical evidence retained

The original run remains a real failure: 40 of 43 cases passed, while returning
accepted-analytics/dark visits to `/`, `/compare`, and `/faq` emitted React #418.
Later clean reruns did not identify a causal repair. The original artifacts remain
unchanged:

- `hydration-initial.log` SHA-256:
  `4d5a4e0390351c95e1a67d0d1f642cdb7950feae356f9c39ee544ed7812df84f`
- `hydration-investigation.json` SHA-256:
  `ee1e5c2267676f614478eba7e18f7cb621b70dec7bec01427a4b118d19262f9a`

## Exact production identity

At verification, `app.declutrmail.com` resolved through Vercel to READY production
deployment `dpl_Fg1sz6RDTdKK1aBzCCHV4dxhAaXG`. The deployment metadata and Git source
both identify main commit `351beb54d15c9842f6d77680b54ce7571fa02174`; the deployment
aliases include `app.declutrmail.com`. The built-in Codex browser rendered the
production homepage with its main content, navigation, consent/theme controls and
no visible framework overlay.

## Production results

The unchanged repository hydration gate ran twice against the exact production
alias. The second invocation started a new Playwright browser process; each case
also received its own browser context, so stored state and HTTP cache were cold per
case.

| Run | Started (UTC)       |       Result | Skips | Unexpected | Flaky | Duration |
| --- | ------------------- | -----------: | ----: | ---------: | ----: | -------: |
| 1   | 2026-10-08 05:40:57 | 27/27 passed |     0 |          0 |     0 |   36.6 s |
| 2   | 2026-10-08 05:41:36 | 27/27 passed |     0 |          0 |     0 |   30.5 s |

Each run used this invocation, with a distinct `E2E_JSON_REPORT` path:

```sh
E2E_SKIP_STACK_SETUP=1 \
E2E_WEB_URL=https://app.declutrmail.com \
E2E_JSON_REPORT=/tmp/hydration-prod-run-N.json \
pnpm --filter @declutrmail/e2e exec playwright test \
  specs/hydration-smoke-public.spec.ts --project=default --workers=1
```

The privacy-safe JSON report SHA-256 values were
`b0dafccf984efab799fd949714fb40ee98f8cd5450927c973c6850aec62357b7`
for run 1 and
`ed218bbb734534741e547b2a77a8187fbed446d0c5dc52ed1f4d29d5a37a2aac`
for run 2.

All six executions of the three historically failing route/state pairs passed. The
stored consent and dark-theme assertions passed, so those cases did not silently
degrade into first-visit checks. `scripts/assert-e2e-ran.mjs` independently
confirmed that all 27 tests ran in each report with zero skips.

The protected merge-group run
[37732445280](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/37732445280)
built and exercised the same commit before production deployment. Its unchanged
full hydration gate passed 43/43 with zero skips: the same 27 public cases plus 16
authenticated server-hydrated routes on the isolated release stack. This supplies
the authenticated source/build companion evidence required by the historical
release condition; it is not a claim that those 16 routes were exercised against
the production account or production data.

## Current telemetry observation

The encrypted read-only Sentry workflow
[37733723368](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/37733723368)
collected the bounded production seven-day projection at
`2026-10-08T05:42:36.845Z`. It returned eight unresolved issues. The only sampled
`react-error-418` issue was `DECLUTRMAIL-WEB-2C`, last seen
`2026-10-03T23:22:29Z` on older release
`e96263e345cd85c0df9cd2f00b5a21d9569cd69e`, tagged for the Autopilot surface.
No sampled React #418 event identifies the current release or these public routes.
This is supporting evidence only: the projection is bounded, and previously
exhausted Sentry capacity means absence cannot prove zero production errors.

## Disposition

HYDRATION-01—the public accepted-consent/dark-theme signal on `/`, `/compare`, and
`/faq`—is retired as an initial-launch blocker for production deployment
`dpl_Fg1sz6RDTdKK1aBzCCHV4dxhAaXG`. This is a release-verification disposition,
not a claim that the original intermittent cause was found or repaired. The
historical failure remains preserved, and production-authenticated hydration is
not claimed by this rehearsal.

If merging this audit creates a successor Vercel deployment, transfer this
disposition only after reading back the production alias, confirming the successor
is READY, and confirming its change from `351beb54` is documentation-only and
therefore runtime-equivalent. Any runtime source change requires a new production
rehearsal.

Reopen HYDRATION-01 if the required hydration gate recurs, if a current-release
React #418 event identifies one of these public routes, or if a deployment changes
the consent/theme initialization path without equivalent production rehearsal.
No source patch is justified by the current evidence.
