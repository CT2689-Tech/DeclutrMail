## 2026-10-03 — Scope database CA by the driver's effective host

**PR:** API driver readiness prerequisites (link added when created)
**Caught by:** architecture-guardian independent no-network probe
**What happened:** The initial CA selector used the URL authority, but pg accepts
query-string host overrides and the last duplicate wins. A Supabase authority with
an external host override received the Supabase CA, while an external authority
with a Supabase override missed it. TLS verification remained enabled.
**Correct approach:** Read pg Client's effective host before choosing the CA.
**Rule:** Scope connection policy using the driver's parsed destination, including
DSN overrides, rather than only `URL.hostname`.
**Enforcement update:** Four converse/duplicate-host unit cases; real private
read-only connection with authority replaced and effective host preserved.
