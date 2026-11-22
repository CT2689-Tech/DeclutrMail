### 2026-11-21 — GCP spend is over the monthly budget

**Source:** `vendor-limits-watchdog` run on 2026-11-21
**Why:** the watchdog's Google Cloud row reports `BREACH` on the monthly
budget alert, with a month-end estimate well above the budget (amounts are in
the run's "check" table, not here: this repo is public). The watchdog was red
every day for other reasons, so the breach went unread.
**How:**
1. Open https://console.cloud.google.com/billing and pick the DeclutrMail
   billing account → **Reports**, grouped by **Service**, for this month.
2. Note the top three services and their cost, and send them to an agent.
   The agent finds the cause in code or config and proposes a fix with its
   saving.
3. Decide: fix the cause, or raise the budget to a number you choose.
**Verifies by:** the watchdog's Google Cloud row is not `BREACH` on the
next run, or the budget was raised on purpose.
**Status:** Open
