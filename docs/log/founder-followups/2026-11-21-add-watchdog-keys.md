### 2026-11-21 — Add the two keys the cost watchdog is missing

**Source:** tooling cleanup, PR #1229
**Why:** `vendor-limits-watchdog` has been red 32 of 34 days, so nobody reads
it. Two of its rows fail only for a missing key: Anthropic (the Admin API
needs an Admin key, so it answers 401) and Paddle (`PADDLE_WATCHDOG_API_KEY`
is not set). Only the founder can create these keys.
**How:** paste the prompt below into Claude.ai. It drives the browser, never
types a secret, and asks for a "yes" before each save.

> Help me add two API keys to GitHub Actions secrets for a daily cost
> watchdog. Never type a secret: place the cursor and tell me to paste. Ask
> my "yes" before every final Save / Create.
> 1. Open https://console.anthropic.com/settings/admin-keys. Create an Admin
>    key named `declutrmail-vendor-limits-watchdog`. Tell me to copy it.
> 2. Open https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions
>    and create or update `ANTHROPIC_ADMIN_KEY`; I paste the value.
> 3. Open https://vendors.paddle.com/authentication-v2 with the **Live**
>    toggle on. Create an API key named `declutrmail-watchdog-readonly`
>    with only "Notification settings: Read" and "Notifications: Read",
>    expiring in one year. Tell me the expiry date and to copy the key.
> 4. In the same GitHub secrets page create or update
>    `PADDLE_WATCHDOG_API_KEY`; I paste. In
>    https://github.com/CT2689-Tech/DeclutrMail/settings/variables/actions
>    set the variable `PADDLE_WATCHDOG_KEY_EXPIRES_ON` to that date
>    (`YYYY-MM-DD`).
> 5. Open
>    https://github.com/CT2689-Tech/DeclutrMail/actions/workflows/vendor-limits-watchdog.yml
>    and run it on `main`. When it finishes, report the Anthropic and
>    Paddle rows of the "check" job's table.

**Verifies by:** the next watchdog run shows Anthropic and Paddle rows that
are not `ERROR`. (The Sentry row's "no outcome groups" error is a watchdog
bug, tracked separately.)
**Status:** Open
