# Handoff — retire the `declutrmail.ai` website (D128)

**Date:** 2026-07-21
**Branch:** `chore/d128-retire-declutrmail-ai-origin` (1 commit, **local only — not pushed**)
**Repo:** `/Users/chintant/projects/DeclutrMail`
**Status:** code complete + verified end-to-end. Remaining work is Vercel dashboard + Search Console + Workspace, none of it in the repo.

---

## The one-paragraph version

V1 of the product shipped on `declutrmail.ai`; V2 was rebuilt on `declutrmail.com` (D128). The `.ai` site is **still live and indexed** and its meta description advertises `"160-char snippets"` — copy that contradicts the current no-body-storage posture (D7/D228) and competes with `.com` in search. This change makes `.ai` serve 301s to `.com` instead. The `.ai` **domain registration is NOT being retired** — see the hard constraint below.

---

## Hard constraint: `.ai` can never be allowed to lapse

Verified via `gcloud organizations list` and `docs/ops/sync-infra-state.md`:

- Google Workspace **primary domain** = `declutrmail.ai`
- GCP **organization root** = `declutrmail.ai`, org ID `630332136083`, customer `C02xlpbpe`
- gcloud admin identity = `admin@declutrmail.ai`

Dropping the registration would break the GCP org, the admin login, and every `@declutrmail.ai` mailbox. **Keep it registered and auto-renewing forever.** Only the _website_ is retired.

---

## Why the redirect is not a DNS change

DNS resolves a name to an address. It cannot see URL paths and has no notion of HTTP status codes — there is no "301 record". Pointing `.ai`'s DNS at `.com` would make `.ai` _serve_ the `.com` site under the old hostname (duplicate content + TLS cert-name mismatch), not redirect it.

Additionally, `declutrmail.ai`'s apex carries the Google Workspace **MX records**. A CNAME at that apex is illegal per RFC 1034 and would shadow the MX, breaking mail to `admin@declutrmail.ai`.

Therefore the 301 must be issued by an HTTP server, which means `declutrmail.ai` must stay attached to a Vercel project — specifically `declutr-mail`, where this code lives.

Rejected alternative: Squarespace registrar URL forwarding. No path mapping (all 55 URLs would dump on the homepage — soft-404s), no control over the status code, and it layers on the zone carrying the MX.

---

## Verified infrastructure facts (all checked live 2026-07-21)

| Fact                     | Value                                                                                              | How checked                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `.ai` site               | live 200, Vercel project `declutr-front-zen`, Vite, **no connected Git repo**, last deploy 69d ago | `vercel project inspect`               |
| `.com` site              | live, Vercel project `declutr-mail`                                                                | `vercel projects ls`                   |
| Registrar (both)         | Squarespace                                                                                        | `whois`                                |
| `.com` expiry            | **2026-10-12** — ~83 days out, needs renewal                                                       | `whois`                                |
| `.ai` expiry             | 2027-10-12                                                                                         | `whois`                                |
| NS (both)                | `ns-cloud-*.googledomains.com` = Squarespace's inherited legacy Google Domains NS                  | `dig NS`                               |
| DNS is **not** Cloud DNS | `gcloud dns managed-zones list` → 0 items in all 3 GCP projects                                    | gcloud                                 |
| `.ai` DNS                | A → Vercel; Workspace MX; SPF; DMARC `p=quarantine`; 2× google-site-verification TXT               | `dig`                                  |
| `.com` DNS               | apex A `76.76.21.21`; `www`+`app` → `cname.vercel-dns.com`; `api` → `ghs.googlehosted.com`         | `dig`                                  |
| `api.declutrmail.com`    | Cloud Run domain mapping → `declutrmail-api`, healthy                                              | `gcloud beta run domain-mappings list` |
| `.com` DMARC             | `p=none` — weaker than `.ai`'s `p=quarantine`                                                      | `dig TXT _dmarc`                       |

**DNS edits are done in the Squarespace panel, by hand. There is no CLI/API/MCP for it.** (An earlier read in this session wrongly assumed Cloud DNS — the `googledomains.com` NS hostnames are misleading.)

---

## What the code does

Three files, all under `apps/web`:

- `src/lib/legacy-domain-redirects.ts` — the rules
- `src/lib/legacy-domain-redirects.test.ts` — 55 tests
- `next.config.ts` — `redirects: async () => legacyDomainRedirects()`

Design decisions, each with a reason:

1. **Routing layer (`next.config`), not `middleware.ts`.** Vercel's edge router handles config redirects with zero function invocations. Middleware would bill one per redirected hit and drag the CSP nonce logic into a bodyless response.
2. **`statusCode: 301`, not Next's `permanent: true`** (which emits 308). Search Console's Change of Address tool documents 301.
3. **Every rule is host-gated** on `has: [{ type: 'host', value: '(www\\.)?declutrmail\\.ai' }]`. An ungated rule would also match `declutrmail.com` and redirect the canonical origin to itself — an infinite loop that takes prod down. This is the single most dangerous failure mode; it has its own tests.
4. **Explicit V1→V2 path map, not a bare catch-all.** V1 and V2 share only six paths (`/`, `/blog`, `/compare`, `/contact`, `/faq`, `/pricing`). The other 38 indexed URLs live under sections V2 doesn't have (`/guides/*`, `/topics`, `/tools/*`, `/legal/*`) or use renamed slugs. A path-preserving catch-all alone would 301 all of them onto `.com` 404s — **strictly worse than doing nothing**, because Google drops a URL that redirects to a 404 rather than transferring its equity. Rule order is: exact map → `/guides/*` pattern rules → path-preserving catch-all last (Next matches in array order).

> This catch-all defect was in the first draft and was caught by the Codex stop-time review gate, not by tests or CI. Worth remembering as a class: _a redirect that "works" (200→301) can still be an SEO regression if nobody checks what's on the other end._

---

## Verification already done

```
pnpm --filter @declutrmail/web exec vitest run src/lib/legacy-domain-redirects.test.ts   # 55 passed
pnpm --filter @declutrmail/web typecheck                                                  # clean
```

End-to-end smoke — for each V1 URL, ask the local dev server (as `declutrmail.ai`) where it redirects, then ask the **live** `declutrmail.com` whether that target exists:

```bash
ORIGIN=http://localhost:3000 HOSTHDR=declutrmail.ai \
  <scratchpad>/redirect-smoke.sh < <scratchpad>/v1-urls.txt
```

**Result: 55/55 → 301 → live 200. `failures: 0`.** Covers 44 sitemap URLs + 3 AI-context files + 8 V1 app routes. Also confirmed `declutrmail.com` and `localhost` still return 200 (no self-redirect loop).

The two scratchpad files are session-temporary. `v1-urls.txt` regenerates with:

```bash
curl -sS https://declutrmail.ai/sitemap.xml \
  | grep -oE "<loc>[^<]+</loc>" \
  | sed -E 's|</?loc>||g; s|https://declutrmail\.ai||' \
  | sed 's|^$|/|' | sort -u
```

...plus these appended by hand: `/llms.txt /llms-full.txt /ai.txt /dashboard /review /undo /auto-clean /rules /categories /simulate /auth/callback`.

The smoke script itself is ~15 lines of bash: read paths on stdin, `curl -o /dev/null -w "%{http_code} %{redirect_url}" -H "Host: $HOSTHDR" "$ORIGIN$path"`, assert 301, then `curl` the returned `Location` and assert 200. Rewrite it if it's gone.

---

## Remaining work

### In the repo (needs an agent)

1. **Push the branch and open the PR.** Body must contain `Closes D128`. D128 (`Primary domain: DeclutrMail.com`) is `⬜ Not started` at `IMPLEMENTATION-LOG.md:182`; merging flips it to 🔵.
2. Optional cleanup, separate PR: ~20 test files use `@declutrmail.ai` addresses as fixture data. Harmless, but renaming to `@example.com` stops future confusion. `docs/execution/buildout-prerequisites-2026-06-11.md:74` says "Retire declutrmail.ai" — should be reworded to _website retired, registration + identity retained_.

### Cutover (founder, Vercel dashboard) — ORDER IS LOAD-BEARING

No DNS changes at any step. `.ai`'s A record and `www` CNAME already point at Vercel and keep working when the domain changes projects.

0. **Snapshot `.ai`'s DNS records** (`dig` the A/MX/TXT/SPF/DMARC set) so there is a known-good baseline to diff against afterwards. Confirm both Vercel projects are on the same team — if not, reassignment triggers an ownership TXT challenge.
1. **Merge + deploy** the PR to `declutr-mail`. Rules are host-gated so they're inert until `.ai` points there — zero risk to `.com`.
2. **Reassign `declutrmail.ai` + `www.declutrmail.ai` to `declutr-mail`** using Vercel's move flow (add the domain to `declutr-mail`; it prompts to move it from `declutr-front-zen`). Treat apex and www as a pair — order between them doesn't matter, but verify both before touching anything else. **Do not** use Vercel's built-in "Redirect to another domain" toggle — the repo code does the path mapping the toggle can't.
3. **Verify**: TLS reprovisioned on both hostnames, then the smoke script against prod (`ORIGIN=https://declutrmail.ai HOSTHDR=declutrmail.ai`, expect `failures: 0`), then re-`dig` and confirm MX/SPF/DMARC/verification TXT are untouched.
4. **Search Console** → Change of Address, `.ai` → `.com`. Only after step 3 passes and the redirects are crawlable. Both properties already carry `google-site-verification` TXT records.
5. **Only after a stabilization window, delete `declutr-front-zen`.**
   **Irreversible**, and that project has _no connected Git repo_ — deleting destroys its deployment history and env vars. Confirm the V1 source folder still exists locally, or accept losing it. Nothing in this repo references `declutr-front-zen`, so no code breaks.

**Two traps:**

- **Reassigning before step 1** — `.ai` would serve the live V2 site under the old hostname, i.e. real duplicate content, worse than today's stale site.
- **Deleting `declutr-front-zen` before step 2** (my original advice, corrected by the Codex review) — that strands `.ai` on a 404 for the length of the gap and destroys the rollback target. Reassignment is zero-downtime; deletion is not reversible. Move first, delete last.

### Unrelated to this PR but found during the audit (founder)

- **`support@declutrmail.com` is probably bouncing today.** `.com` has Google Workspace MX, but `.com` still needs to be added as a **domain alias** of the `declutrmail.ai` Workspace. `docs/execution/launch-readiness-2026-07-18.md:56` marks this pending. Shipped copy already advertises `support@declutrmail.com` (`packages/shared/src/contracts/error-codes.ts:214,221,247`) and `privacy@declutrmail.com` (`apps/web/src/features/marketing/learn/faq-content.ts:139`). **Verify before launch traffic.**
- **Renew `declutrmail.com`** (expires 2026-10-12) and turn on auto-renew for both domains.
- **`_dmarc.declutrmail.com` is `p=none`** while `.ai` is `p=quarantine`. Consider hardening.
- **Not audited, needs your eyes** (§9 stop-conditions — do not let an agent change these): Google OAuth consent screen authorized domains + redirect URIs, Paddle + Razorpay approved domains, Sentry/PostHog allowed origins, Resend domains. Confirm none still reference `.ai`.

---

## Codex review — findings and disposition

A Codex review of the redirect map and cutover plan came back after the handoff was first written. Verdict: approach correct, four things needed changing.

**Applied in this branch:**

- **`/guides/inbox-zero-strategy` → `/methodology` was a bad match** (that page covers data/privacy/automation design, not inbox-zero strategy). Retargeted to `/answers/best-way-to-clean-gmail-2026`; verified 200 on live `.com`.
- **`packages/shared/src/shell/sidebar.tsx` renders the wordmark as "DeclutrMail`.ai`"** — the wrong domain, in the live app shell, directly contradicting D128. Changed to `.com`. This is the only such string in the codebase. **This makes the PR a visual change to `packages/shared` — per the post-PR-3 design freeze it likely needs the `redesign` label, and `design-system-agent` is a gate on that path.**
- **Cutover order corrected** — see the two traps above. Reassign the domain first, delete the old project last.

**Open — decide before merge:**

- **`/auth/callback` forwards OAuth query params cross-origin.** Verified live: `/auth/callback?code=SECRET123&state=xyz` → `https://declutrmail.com/sign-in?code=SECRET123&state=xyz`. Next.js appends unconsumed source query params to the destination and offers no way to strip them from `next.config` — a middleware branch is the only config-free fix.
  Severity is genuinely low: the code is single-use, bound to V1's OAuth client, that client is being retired, and the path was `robots.txt`-disallowed so it was never indexed. But it does put a credential in a URL that crosses origins and lands in Vercel access logs. Options: (a) accept and document, (b) middleware early-return that rebuilds a clean `/sign-in` URL for this host+path, (c) drop the mapping entirely and let it 404. Recommend (b) if anyone touches this file again; (a) is defensible as-is.

**Codex corrections to facts stated earlier in this doc:**

- Squarespace _does_ document ALIAS record support, so apex flattening is technically available. Doesn't change the conclusion — ALIAS still only makes `.ai` _serve_ content, it cannot emit a 301.
- Squarespace registrar forwarding emits real server-side 301s (not meta-refresh) and coexists fine with the existing MX/SPF/DMARC/TXT records. Still rejected: it can only preserve-all or strip-all paths, cannot express this per-path map, and drops query strings. Propagation can take up to 48h.
- The host matcher is unanchored in the source, but Next 15.5.20's `prepare-destination.js` anchors it (`^…$`) after lowercasing and port-stripping, so hostile hostnames like `evildeclutrmail.ai` cannot match. Safe on the installed runtime — but it is runtime-dependent behaviour, so keep the test that asserts it.

**Codex items still unverified (need eyes outside this repo):**

- Live `NEXT_PUBLIC_APP_URL` on Vercel, and the canonical / sitemap / robots / JSON-LD output it feeds (`apps/web/src/features/marketing/landing/urls.ts:9`). In-repo default is correct; the deployed env var was not checked.
- OAuth consent-screen URLs `.ai` → `.com`, and registering `.com` with Paddle + Razorpay — both already flagged at `docs/execution/buildout-prerequisites-2026-06-11.md:70`.
- `.github/workflows/deploy-cloud-run.yml:228` already uses `.com` throughout (WEB_URL, OAuth callback, CORS, cookie scope) — confirmed good, no action.
