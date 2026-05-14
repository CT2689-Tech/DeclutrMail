# Security and privacy

The privacy oath is the entire product promise. Every code path enforces it; every UI restates it. Security baselines below operationalize it.

## Privacy oath — DeclutrMail's six product invariants

1. **Never reads email bodies.** Gmail metadata scope only. Headers + the same one-line ~160-char preview Gmail shows in list view is the maximum. Models that generate the daily Brief see only sender metadata.
2. **Bodies-read counter.** Settings displays "Bodies read: 0 bytes." The number is verifiably zero. The day it isn't is a P0 incident.
3. **7-day undo on every irreversible action.** Archive, mute, unsub, snooze, brief-archive, autopilot run — all reversible from the activity log for 7 days.
4. **No third-party data egress beyond declared processors.** When an LLM is used, it's named (Anthropic Claude). No analytics provider ever sees email content. No "anonymous data product."
5. **Hard delete on account removal.** All user-derived rows scrubbed from prod within 30 days of account deletion.
6. **Open scopes manifest.** OAuth scopes listed in Settings → Privacy with plain-English explanation and raw scope strings behind a disclosure.

Any feature that pressures these invariants is rejected. Any copy that softens the language ("we don't read bodies for ads" — implies we read for other reasons) is reverted.

## Security baselines

### Database

- Every table has RLS enabled at creation. Migration adding a table without RLS is rejected.
- Default policies scope by `user_id`. Cross-user access goes through service-role functions, never direct queries.
- Service role key only in edge functions (Deno runtime). Never bundled into the frontend.

### Secrets

- Frontend env vars are `VITE_*` prefix only. Anything sensitive is _not_ `VITE_*`.
- `.env.local` is git-ignored. `.env.local.example` documents required keys without values.
- Supabase service role + Anthropic API + Paddle/Razorpay secrets live in Supabase Edge Function secrets — never in code.

### OAuth

- Gmail metadata scope only by default. Any additional scope arrives in a PR that explains why.
- Redirect URIs configured in the Google Cloud client by hand. No env-driven redirect manipulation.

### CSP

- Default-deny. Allowlist additions go through `vercel.json` with a per-line comment explaining why.
- No `unsafe-inline` in `script-src`. `unsafe-inline` in `style-src` is permitted (Tailwind runtime requires it).
- `frame-ancestors 'none'`. `form-action 'self'`.

### Logs

- Never log message bodies, snippets, or sender domains paired with body content.
- Email addresses: domain-only in telemetry (`@gmail.com`); never full addresses.
- Sentry breadcrumbs are structured. Redact known-sensitive fields before send.
