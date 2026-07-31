# AGENTS.md

Primary operating manual for this repo is **`CLAUDE.md`** (read it first).
Standard dev commands live in `CLAUDE.md` §"Quick reference"; run commands in
`package.json`; and the `scripts/` bring-up scripts (`dev-up.sh`, `dev-api.sh`,
`dev-worker.sh`, `db-migrate.sh`). This file only adds Cursor Cloud specifics.

## Cursor Cloud specific instructions

The startup update script runs `pnpm install` only. Everything below is the
non-obvious runtime context that is NOT handled automatically.

### Services & how they run here

- **Postgres and Redis are installed natively via apt (NOT Docker).** Docker is
  not installed in this environment. `scripts/dev-up.sh` detects no Docker,
  prints a warning, and skips its Redis sidecar — that is expected and fine
  because native Redis already serves `redis://localhost:6379`.
- Postgres and Redis do **not** auto-start on a fresh VM boot. Start them
  before running anything DB/queue-related:
  `sudo service postgresql start` and `sudo service redis-server start`.
- Postgres creds are `postgres` / `postgres`, DB `declutrmail`, on `:5432`
  (matches `DATABASE_URL` in `.env.example`). The `atlas` CLI (needed by
  `scripts/db-migrate.sh`) is installed at `/usr/local/bin/atlas`.
- Bring the app up with `DEV_UP_NO_STUDIO=1 ./scripts/dev-up.sh` (api `:4000`,
  worker, web `:3000`). Skip Drizzle Studio via `DEV_UP_NO_STUDIO=1` — it
  proxies through the external `local.drizzle.studio` host which is not reliable
  in this sandbox. Logs land in `.local-logs/{api,worker,web}.log`.

### Env files (gitignored — recreate if missing)

- Two env files are required and are gitignored, so they are absent on a fresh
  clone: root `.env.local` (API + worker + scripts) and `apps/web/.env.local`
  (Next.js reads env from its own CWD, only the `NEXT_PUBLIC_*` vars).
- Minimum root `.env.local` for local dev: `DATABASE_URL`, `REDIS_URL`,
  `ENCRYPTION_LOCAL_KEY` (`openssl rand -hex 32`), `JWT_ACCESS_SECRET` +
  `JWT_REFRESH_SECRET` (must differ), `WEB_URL`/`API_URL` +
  `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_API_URL`, `GMAIL_CONNECT_ENABLED=true`,
  and for the dev test-login `DEV_AUTH_ENABLED=true` +
  `DEV_AUTH_EMAIL_PREFIX=chintan`.
- **The worker refuses to boot without `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`**
  (the API boots without them). Set any non-empty placeholder values locally —
  they are only used for real Gmail API calls, not for boot.

### Auth / data for smoke tests (no real Gmail)

- There is no real Google OAuth here. Seed a ready-to-use workspace with
  `psql "$DATABASE_URL" -f scripts/cloud-seed.sql` (idempotent). It creates the
  user `chintan.a.thakkar@gmail.com` with two active, sync-ready mailboxes plus
  sample senders/messages.
- Log in via the D206 dev test-login by navigating the browser to
  `http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com`
  (302-redirects to `/senders` with session cookies set).
- The seeded mailboxes have **no stored OAuth tokens**, so anything that hits
  the live Gmail API (initial/incremental sync, Archive/Delete/Unsubscribe
  execution) will fail with `has no stored OAuth token`. DB-only actions work
  fully end-to-end — e.g. protecting/keeping a sender
  (`PATCH /api/senders/:id/policy`). Use those for authed smoke tests unless the
  founder supplies real Gmail credentials + tokens.
