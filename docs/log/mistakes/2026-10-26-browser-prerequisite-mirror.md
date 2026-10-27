## 2026-10-26 — Recover a stalled runner package mirror without bypassing coverage

**PR:** [#1156](https://github.com/CT2689-Tech/DeclutrMail/pull/1156)
**Caught by:** required responsive CI setup
**What happened:** The diagnostic rerun never reached browser tests: three
four-minute dependency attempts timed out downloading Ubuntu font packages from
the runner's Azure mirror. The earlier independent 34-pixel paint comparison
remains recorded in the PR; setup failure is a separate condition.
**Correct approach:** On the second dependency attempt, replace only the known
Azure Ubuntu origin with the official Ubuntu HTTPS origin in the GitHub Linux
x64 runner's mirror list. Keep priorities, repositories, signature verification,
root process cleanup, runner-owned browser files and every coverage assertion.
**Rule:** Diagnose setup failure separately from a failed product assertion;
recover the dependency source without treating missing test execution as green.
**Enforcement update:** Installer regressions cover privileged fallback ordering,
failure before browser execution, environment/file guards and metadata preservation.
Mirror recovery has its own deadline and consumes the existing attempt budget.
