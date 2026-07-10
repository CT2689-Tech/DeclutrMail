#!/usr/bin/env bash
#
# launch-preflight.sh — machine-checkable state of the founder launch
# checklist (docs/execution/founder-launch-checklist.md).
#
# Every founder task in that doc has a probe here. Agents (and the
# founder) run this instead of re-deriving curl/dig invocations by hand:
#
#   ./scripts/launch-preflight.sh            # all checks
#   ./scripts/launch-preflight.sh dns mail   # only named groups
#
# Exit 0 = every check in the selected groups passed.
# Exit 1 = at least one FAIL. WARN never fails the run.
#
# Uses only curl + dig so it runs in CI, in a cloud sandbox, and on the
# founder's laptop. `vercel` / `gcloud` checks self-skip when the CLI is
# absent or its credentials have expired.
set -uo pipefail

APEX=declutrmail.com
APP=app.declutrmail.com
API=api.declutrmail.com
CANONICAL_ORIGIN="https://${APEX}"

# Pinned, never inherited from `gcloud config`. An active project set to
# anything else would otherwise let these checks PASS against the wrong
# infrastructure — a green run that proves nothing.
GCP_PROJECT=declutrmail-ai-prod
GCP_REGION=us-central1
VERCEL_PROJECT=declutr-mail

PASS=0 FAIL=0 WARN=0 SKIP=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        ↳ %s\n' "$2"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        ↳ %s\n' "$2"; WARN=$((WARN+1)); }
skip() { printf '  \033[90mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
group(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

code() { curl -s -o /dev/null -w '%{http_code}' -L --max-time 15 "$1" 2>/dev/null; }
hdr()  { curl -sI --max-time 15 "$1" 2>/dev/null | tr -d '\r'; }

# NEVER pipe curl straight into `grep -q` here. `grep -q` exits on the
# first match, curl then dies on a write error (exit 23/56), and with
# `set -o pipefail` the whole pipeline reports failure — so the check
# fails EXACTLY WHEN the content it is looking for is present. Capture
# the body first, then match it.
fetch() { curl -sL --max-time 15 "$1" 2>/dev/null; }
body_has()     { printf '%s' "$1" | grep -qF "$2"; }
body_matches() { printf '%s' "$1" | grep -qE "$2"; }

# Extract the DKIM `p=` tag value from a raw `dig +short TXT` result.
#
# Two things make a naive regex on the raw string wrong, and both produce
# FALSE REVOCATIONS on records that are perfectly valid:
#   - dig renders long TXT records as adjacent quoted chunks, and the
#     split can land a few chars after `p=`.
#   - RFC 6376 permits folding whitespace *inside* a tag value, so the
#     base64 may contain spaces.
# Strip quotes and all whitespace first (tags are ';'-delimited, so no
# whitespace is load-bearing), then read the value up to the next ';'.
#
# We deliberately do NOT impose a minimum key length. RFC 6376 §3.6.1
# says an EMPTY p= means "revoked" — that is the only distinction that
# exists. Inventing a length floor rejects short-but-legal keys (Ed25519
# is 44 chars; padded RSA can be shorter still).
dkim_norm()   { printf '%s' "$1" | tr -d '"' | tr -d '[:space:]'; }

# Decoded byte length of a well-formed base64 string, by arithmetic.
# Deliberately openssl-free: Ed25519 validation is only a length check,
# and routing it through `openssl base64` made a valid key report
# "0 bytes" on any host without openssl — a hard FAIL on a correct record.
b64_bytes() {
  local k="$1" pad=0
  case "$k" in *==) pad=2 ;; *=) pad=1 ;; esac
  echo $(( ${#k} / 4 * 3 - pad ))
}
dkim_pubkey() { dkim_norm "$1" | grep -oE '(^|;)p=[A-Za-z0-9+/=]*' | head -1 | sed -E 's/^;?p=//'; }
dkim_alg()    { dkim_norm "$1" | grep -oE '(^|;)k=[A-Za-z0-9-]+'   | head -1 | sed -E 's/^;?k=//'; }

# Classify a DKIM TXT record. Non-empty is NOT the same as usable: a
# truncated or corrupted `p=` is well-formed base64 and decodes to bytes,
# but verifies nothing. So we decode it and require it to parse as an
# actual public key. Prints one of:
#   missing | revoked | malformed:<reason> | ok:<bytes>
dkim_status() {
  local raw key alg n
  raw=$(dkim_norm "$1")
  [ -n "$raw" ] && printf '%s' "$raw" | grep -q 'p=' || { echo missing; return; }
  key=$(dkim_pubkey "$1")
  [ -z "$key" ] && { echo revoked; return; }

  # base64 charset + padding. `openssl base64 -d` silently skips invalid
  # characters, so it cannot be used to validate — only to decode.
  printf '%s' "$key" | grep -qE '^[A-Za-z0-9+/]+={0,2}$' && [ $(( ${#key} % 4 )) -eq 0 ] \
    || { echo 'malformed:not valid base64'; return; }

  alg=$(dkim_alg "$1"); [ -z "$alg" ] && alg=rsa   # RFC 6376: k defaults to rsa

  if [ "$alg" = ed25519 ]; then
    # Ed25519 publishes the RAW 32-byte key, not a SubjectPublicKeyInfo,
    # so validation is a length check and needs no crypto library.
    n=$(b64_bytes "$key")
    [ "$n" = 32 ] && echo 'ok:Ed25519 (32-byte)' || echo "malformed:ed25519 key is ${n} bytes, expected 32"
    return
  fi

  # RSA needs a real parse, which needs openssl. Without it, say so —
  # never report an unparsed key as present (same rule as a missing
  # credential: that is a SKIP, not a PASS).
  command -v openssl >/dev/null 2>&1 || { echo unverified; return; }

  local text bits
  text=$(printf -- '-----BEGIN PUBLIC KEY-----\n%s\n-----END PUBLIC KEY-----\n' "$key" \
           | openssl pkey -pubin -noout -text 2>/dev/null)
  [ -z "$text" ] && { echo 'malformed:does not parse as a public key (truncated or corrupt)'; return; }

  # `openssl pkey -pubin` happily parses EC/DSA/Ed25519 SPKIs too. A
  # record saying k=rsa must actually carry RSA, or signing breaks.
  printf '%s' "$text" | grep -q 'Modulus:' \
    || { echo 'malformed:k=rsa but the key is not RSA'; return; }

  # RFC 8301: signers MUST NOT use RSA keys below 1024 bits.
  bits=$(printf '%s' "$text" | sed -nE 's/.*Public-Key: \(([0-9]+) bit\).*/\1/p' | head -1)
  [ -n "$bits" ] && [ "$bits" -ge 1024 ] 2>/dev/null \
    || { echo "malformed:RSA key is ${bits:-unknown} bits, RFC 8301 requires >= 1024"; return; }

  echo "ok:${bits}-bit RSA"
}

# Every DNS assertion goes through the zone's AUTHORITATIVE nameserver.
# The system resolver caches negatively: right after a record is added,
# repeated runs flapped between "MX missing" and "SPF missing" purely on
# which negative entry had expired. A preflight that returns different
# answers for identical DNS state is worse than no preflight.
#
# Authoritative means "the record exists", which is what a checklist item
# asserts. Global propagation is a separate, time-bounded question — the
# TTL here is 4h, so recursive resolvers catch up on their own.
NS_AUTH=$(dig +short NS "$APEX" 2>/dev/null | head -1)
[ -z "$NS_AUTH" ] && NS_AUTH=8.8.8.8
digq() { dig +short "$@" "@${NS_AUTH}" 2>/dev/null; }

# ── dns ──────────────────────────────────────────────────────────────
# The apex + www still answer from Squarespace. Until they don't, every
# canonical URL we emit (sitemap, OG, JSON-LD) points at a page that is
# not the product.
check_dns() {
  group 'dns — apex cutover off Squarespace'

  local apex_server www_server
  apex_server=$(hdr "https://${APEX}" | grep -i '^server:' | head -1)
  www_server=$(hdr "https://www.${APEX}" | grep -i '^server:' | head -1)

  case "$apex_server" in
    *[Ss]quarespace*) bad "${APEX} still served by Squarespace" "$apex_server" ;;
    *[Vv]ercel*)      ok  "${APEX} served by Vercel" ;;
    '')               bad "${APEX} unreachable" ;;
    *)                warn "${APEX} served by an unexpected origin" "$apex_server" ;;
  esac

  case "$www_server" in
    *[Ss]quarespace*) bad "www.${APEX} still served by Squarespace" "$www_server" ;;
    *[Vv]ercel*)      ok  "www.${APEX} served by Vercel" ;;
    '')               bad "www.${APEX} unreachable" ;;
    *)                warn "www.${APEX} served by an unexpected origin" "$www_server" ;;
  esac

  [ "$(digq CNAME "$APP" | head -1)" = 'cname.vercel-dns.com.' ] \
    && ok "${APP} → cname.vercel-dns.com" \
    || bad "${APP} CNAME is not cname.vercel-dns.com"

  [ "$(digq CNAME "$API" | head -1)" = 'ghs.googlehosted.com.' ] \
    && ok "${API} → ghs.googlehosted.com (Cloud Run mapping)" \
    || bad "${API} CNAME is not ghs.googlehosted.com"

  # The apex is the marketing origin the app *claims* in sitemap/OG. If
  # it 200s but isn't ours, crawlers index Squarespace. Guard on content.
  if body_has "$(fetch "https://${APEX}")" 'Full bodies fetched: 0'; then
    ok "${APEX} serves the DeclutrMail trust badge"
  else
    bad "${APEX} does not serve DeclutrMail content"
  fi
}

# ── mail ─────────────────────────────────────────────────────────────
# Two independent concerns that share one Cloud DNS zone:
#   inbound  — support@ / privacy@ are published on live pages, so the
#              APEX needs MX. It has none today.
#   outbound — Resend signs as `send.declutrmail.com`, which needs its
#              own DKIM + SPF + bounce MX. Only DKIM is present.
# Both live in the same zone the apex A-records do, so the Squarespace
# cutover must preserve them.
SEND="send.${APEX}"

# Assert CONTENT, never mere existence. `[ -n "$(dig MX …)" ]` passes on
# any MX at all — including RFC 7505's null MX (`0 .`), which explicitly
# means "this domain accepts no mail". A record being present is not the
# same as the record being correct, and email readiness is exactly where
# that difference bites: a stale MX still resolves, and still bounces.
check_mail() {
  group 'mail — inbound mailboxes + outbound (Resend) auth'

  local apex_mx apex_spf dmarc dkim send_spf send_mx
  apex_mx=$(digq MX "$APEX")
  apex_spf=$(digq TXT "$APEX")
  dmarc=$(digq TXT "_dmarc.${APEX}")
  dkim=$(digq TXT "resend._domainkey.${SEND}")
  send_spf=$(digq TXT "$SEND")
  send_mx=$(digq MX "$SEND")

  # Inbound: support@ / privacy@ are published on live pages.
  if body_has "$apex_mx" 'aspmx.l.google.com'; then
    ok "${APEX} MX → Google Workspace (inbound mail deliverable)"
  elif [ -n "$apex_mx" ]; then
    bad "${APEX} MX exists but is not Google Workspace" "got: $(printf '%s' "$apex_mx" | tr '\n' ' ')"
  else
    bad "${APEX} has NO MX records" \
        "support@${APEX} and privacy@${APEX} are published on /help, /contact, /refunds and hard-bounce"
  fi

  body_has "$apex_spf" 'v=spf1' \
    && ok "${APEX} publishes SPF" \
    || bad "${APEX} has no SPF record" "Workspace sending needs 'v=spf1 include:_spf.google.com ~all'"

  body_has "$dmarc" 'v=DMARC1' \
    && ok "${APEX} publishes DMARC" \
    || warn "${APEX} has no DMARC record" 'Add at least p=none before sending volume'

  # Outbound: Resend signs as send.declutrmail.com. All three records are
  # required for the domain to reach "Verified"; DKIM alone is not enough.
  # Missing, revoked, malformed, and usable are FOUR distinct states, each
  # demanding a different response. A truncated key is not "present".
  local dkim_st
  dkim_st=$(dkim_status "$dkim")
  case "$dkim_st" in
    ok:*)        ok "${SEND} DKIM present and parses (${dkim_st#ok:} public key)" ;;
    unverified)  skip "${SEND} DKIM not verified (openssl absent — key was NOT parsed)" ;;
    revoked)     bad "${SEND} DKIM key is REVOKED (empty p=)" 'Resend signatures will fail verification' ;;
    malformed:*) bad "${SEND} DKIM key is UNUSABLE" "${dkim_st#malformed:} — signatures will fail verification" ;;
    *)           bad "${SEND} DKIM missing" 'Resend cannot sign outbound mail' ;;
  esac

  body_has "$send_spf" 'include:amazonses.com' \
    && ok "${SEND} SPF authorizes amazonses.com" \
    || bad "${SEND} SPF missing or does not include amazonses.com" \
           "Resend needs 'v=spf1 include:amazonses.com ~all' on ${SEND}"

  if body_has "$send_mx" 'amazonses.com'; then
    ok "${SEND} bounce MX → feedback-smtp.*.amazonses.com"
  elif [ -n "$send_mx" ]; then
    bad "${SEND} MX exists but is not Amazon SES" "got: $(printf '%s' "$send_mx" | tr '\n' ' ')"
  else
    bad "${SEND} has no bounce MX" 'Resend needs an MX there to process bounces/complaints'
  fi
}

# ── web ──────────────────────────────────────────────────────────────
check_web() {
  group 'web — Vercel app + canonical origin'

  [ "$(code "https://${APP}")" = 200 ] && ok "${APP} responds 200" || bad "${APP} did not respond 200"

  for p in /pricing /help /security /privacy /terms; do
    [ "$(code "https://${APP}${p}")" = 200 ] && ok "${APP}${p} → 200" || bad "${APP}${p} did not respond 200"
  done

  # sitemap.ts derives every <loc> from siteUrl(), which reads
  # NEXT_PUBLIC_APP_URL and falls back to the apex. So a sitemap whose
  # host is unreachable-or-Squarespace is the same bug as an unset env
  # var — assert on the emitted host, not the env var.
  local loc
  loc=$(curl -s --max-time 15 "https://${APP}/sitemap.xml" | grep -oE '<loc>[^<]+</loc>' | head -1 | sed -E 's#</?loc>##g')
  if [ -z "$loc" ]; then
    bad 'sitemap.xml emitted no <loc> entries'
  elif [ "${loc%/}" = "${CANONICAL_ORIGIN%/}" ]; then
    if body_has "$(fetch "$loc")" 'Full bodies fetched: 0'; then
      ok "sitemap canonical host ${loc} resolves to DeclutrMail"
    else
      bad "sitemap canonical host is ${loc}, which is not DeclutrMail" \
          "Either finish the apex DNS cutover, or set NEXT_PUBLIC_APP_URL=https://${APP} and redeploy"
    fi
  else
    warn "sitemap canonical host is ${loc}" "expected ${CANONICAL_ORIGIN}"
  fi
}

# ── api ──────────────────────────────────────────────────────────────
check_api() {
  group 'api — Cloud Run reachability, OAuth, webhook auth'

  # There is no health route (28 controllers, none of them /health), so
  # the liveness proxy is: does the Nest error envelope come back? A 404
  # with our envelope proves the app booted and the filter is wired.
  local root
  root=$(curl -s --max-time 15 "https://${API}/")
  if printf '%s' "$root" | grep -q '"correlationId"'; then
    ok "${API} is up (DeclutrMail error envelope on unknown route)"
  else
    bad "${API} did not return the DeclutrMail error envelope" "got: $(printf '%s' "$root" | head -c 120)"
  fi

  # OAuth entry point must redirect to Google, not error.
  local loc
  loc=$(hdr "https://${API}/api/auth/google/start" | grep -i '^location:' | head -1)
  case "$loc" in
    *accounts.google.com*) ok 'GET /api/auth/google/start → 302 to Google' ;;
    '')                    bad 'GET /api/auth/google/start did not redirect' ;;
    *)                     bad 'GET /api/auth/google/start redirected somewhere unexpected' "$loc" ;;
  esac

  # D229: the Pub/Sub push endpoint must reject an unsigned POST. A 2xx
  # here would mean OIDC verification is off — a security regression.
  local ps
  ps=$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 15 "https://${API}/api/webhooks/gmail/pubsub")
  case "$ps" in
    401|403) ok "unauthenticated POST to /api/webhooks/gmail/pubsub → ${ps}" ;;
    2*)      bad "unauthenticated POST to /api/webhooks/gmail/pubsub → ${ps}" 'OIDC verification is NOT enforcing (D229)' ;;
    # Any other code (000 timeout, 5xx, 404) means we did not observe the
    # rejection. Unobserved is not the same as safe — fail, do not warn.
    *)       bad "unauthenticated POST to /api/webhooks/gmail/pubsub → ${ps}" 'expected 401/403; OIDC enforcement was NOT observed' ;;
  esac

  # Resend webhook. The handler checks in a fixed order:
  #   1. RESEND_WEBHOOK_SECRET unset      → 503 (fail-closed; Resend retries)
  #   2. empty raw body                   → 400  ← BEFORE signature verification
  #   3. bad/missing svix signature       → 401
  # So the probe MUST carry a body. A bodyless POST returns 400 once the
  # secret is bound, and a check expecting 401 could never pass — it would
  # send you hunting a signature bug that does not exist.
  # A 429 means the rate limiter answered before the handler did, so we
  # observed NOTHING about signature enforcement. Retry past the bucket
  # rather than guess. If it never clears, that is a FAIL, not a warning:
  # a run that exits 0 having never seen the 401 has certified nothing.
  local rs attempt
  for attempt in 1 2 3; do
    rs=$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 15 \
           -H 'content-type: application/json' -d '{}' \
           "https://${API}/api/webhooks/resend" 2>/dev/null)
    [ "$rs" != 429 ] && break
    [ "$attempt" -lt 3 ] && sleep 3
  done

  case "$rs" in
    401) ok 'unsigned POST to /api/webhooks/resend → 401 (svix signature enforced)' ;;
    2*)  bad "unsigned POST to /api/webhooks/resend → ${rs}" 'svix signature verification is NOT enforcing' ;;
    404) bad 'POST /api/webhooks/resend → 404' 'ResendWebhookModule never mounted' ;;
    400) bad 'POST /api/webhooks/resend → 400' 'the probe body did not reach the handler as a raw body' ;;
    429) bad 'POST /api/webhooks/resend → 429 after 3 attempts' 'rate limited; signature enforcement was NOT observed' ;;
    # 503 is the designed pre-bind state, but it is still "enforcement not
    # observed". It must fail on its own, not lean on the secrets group —
    # `launch-preflight.sh api` alone would otherwise exit 0 having proven
    # nothing about this endpoint.
    503) bad 'POST /api/webhooks/resend → 503 (module gated)' \
             'RESEND_WEBHOOK_SECRET is unset, so signature enforcement cannot be observed — see the secrets group' ;;
    *)   bad "unsigned POST to /api/webhooks/resend → ${rs}" 'expected 401; enforcement was NOT observed' ;;
  esac
}

# A separate function purely so the unreadable case can `return` before
# any per-variable assertion runs. Reporting "NEXT_PUBLIC_API_URL missing"
# when we never managed to list the env is a false finding, and false
# findings are worse than no findings — they send you fixing a variable
# that is already set.
check_env_vercel() {
  if ! command -v vercel >/dev/null 2>&1 || ! vercel whoami >/dev/null 2>&1; then
    skip 'Vercel env checks (vercel CLI missing or not logged in)'
    return
  fi

  # Three ways this read can lie, all of them guarded below:
  #   1. The command fails but prints something to stdout → gate on the
  #      exit code, never on emptiness. (Vercel happens to send errors to
  #      stderr today; that is not a contract.)
  #   2. `vercel env ls` resolves the project from the CURRENT DIRECTORY's
  #      .vercel link. Run this script from another repo and it reads a
  #      different project at rc=0 and reports a confident, wrong PASS —
  #      the same class of bug as an unpinned gcloud --project.
  #   3. The banner naming the project goes to STDERR, so stdout alone
  #      cannot prove which project answered. Capture both streams.
  local venv rc
  venv=$(vercel env ls production 2>&1); rc=$?

  if [ "$rc" -ne 0 ]; then
    bad "Vercel: \`vercel env ls production\` failed (exit ${rc})" \
        'token expired or project unlinked — the four Vercel variable checks did NOT run'
    return
  fi

  # Trailing space, not \b: BSD grep treats '-' as a word boundary, so
  # "/declutr-mail\b" would happily match "/declutr-mail-staging".
  if ! printf '%s' "$venv" | grep -qF "/${VERCEL_PROJECT} "; then
    bad "Vercel: env listing is not for project ${VERCEL_PROJECT}" \
        "run from the DeclutrMail repo root — the four Vercel variable checks did NOT run"
    return
  fi

  printf '%s' "$venv" | grep -q 'NEXT_PUBLIC_API_URL'    && ok 'Vercel prod: NEXT_PUBLIC_API_URL set'    || bad 'Vercel prod: NEXT_PUBLIC_API_URL missing'
  printf '%s' "$venv" | grep -q 'NEXT_PUBLIC_SENTRY_DSN' && ok 'Vercel prod: NEXT_PUBLIC_SENTRY_DSN set' || warn 'Vercel prod: NEXT_PUBLIC_SENTRY_DSN missing'

  # Already live. The privacy promise is upheld in code (hasAnalyticsConsent()
  # is checked before the SDK is imported), not by withholding the key —
  # so this is a PASS, not the "don't set it yet" the old checklist implied.
  if printf '%s' "$venv" | grep -q 'NEXT_PUBLIC_POSTHOG_KEY'; then
    ok 'Vercel prod: NEXT_PUBLIC_POSTHOG_KEY set (consent-gated in posthog.ts)'
  else
    warn 'Vercel prod: NEXT_PUBLIC_POSTHOG_KEY unset' 'analytics is a silent no-op until it is set'
  fi

  # Unset is the CORRECT state while the apex is canonical: siteUrl()
  # falls back to CANONICAL_ORIGIN, which the `web` group proves serves
  # DeclutrMail. Setting it would only be needed if `app.` became the
  # canonical marketing host (and that needs a redeploy — NEXT_PUBLIC_*
  # is baked at build time).
  if printf '%s' "$venv" | grep -q 'NEXT_PUBLIC_APP_URL'; then
    ok 'Vercel prod: NEXT_PUBLIC_APP_URL set (overrides the apex fallback)'
  else
    ok "Vercel prod: NEXT_PUBLIC_APP_URL unset — siteUrl() falls back to ${CANONICAL_ORIGIN} (canonical)"
  fi
}

# ── env ──────────────────────────────────────────────────────────────
# Reads config, never writes it. Self-skips when creds are stale so the
# script stays runnable in CI and sandboxes.
check_env() {
  group 'env — Vercel + Cloud Run configuration'

  check_env_vercel

  if command -v gcloud >/dev/null 2>&1 && gcloud auth print-access-token >/dev/null 2>&1; then
    local envs
    envs=$(gcloud run services describe declutrmail-api \
             --project="$GCP_PROJECT" --region="$GCP_REGION" --platform=managed \
             --format='value(spec.template.spec.containers[0].env)' 2>/dev/null)
    # FAIL, not WARN. gcloud is authenticated here, so an unreadable
    # service is a broken check, and a broken check must never let the
    # run exit green — that is how the RESEND_API_KEY blocker would hide.
    if [ -z "$envs" ]; then
      bad "Cloud Run: could not read declutrmail-api env in ${GCP_PROJECT}/${GCP_REGION}" \
          'wrong service/region, or the deploy SA lost run.services.get — the env checks below did NOT run'
    else
      printf '%s' "$envs" | grep -q 'COOKIE_DOMAIN' && ok 'Cloud Run: COOKIE_DOMAIN set' || bad 'Cloud Run: COOKIE_DOMAIN missing'
      printf '%s' "$envs" | grep -q 'PUBSUB_WEBHOOK_ENABLED' && ok 'Cloud Run: PUBSUB_WEBHOOK_ENABLED set' || bad 'Cloud Run: PUBSUB_WEBHOOK_ENABLED missing'
      # RESEND_API_KEY intentionally NOT checked here — the `secrets` group
      # owns runtime-secret bindings and reports them with the store context
      # that makes them actionable. One finding, one place.
    fi
  else
    skip 'Cloud Run env checks (gcloud missing, or run `gcloud auth login`)'
  fi
}

# ── pubsub ───────────────────────────────────────────────────────────
# Asserts the *config* of the Gmail push subscription (D229). Delivery of
# a real message is a separate, founder-observable proof — see the
# checklist. A wrong endpoint or audience here means every push 401s.
check_pubsub() {
  group 'pubsub — Gmail push subscription config'

  if ! command -v gcloud >/dev/null 2>&1 || ! gcloud auth print-access-token >/dev/null 2>&1; then
    skip 'Pub/Sub checks (gcloud missing, or run `gcloud auth login`)'
    return
  fi

  local cfg
  cfg=$(gcloud pubsub subscriptions describe gmail-push-sub \
          --project="$GCP_PROJECT" --format='yaml(pushConfig)' 2>/dev/null)
  if [ -z "$cfg" ]; then
    bad "subscription gmail-push-sub not found in ${GCP_PROJECT}"
    return
  fi

  printf '%s' "$cfg" | grep -q "pushEndpoint: https://${API}/api/webhooks/gmail/pubsub" \
    && ok 'pushEndpoint → https://api.declutrmail.com/api/webhooks/gmail/pubsub' \
    || bad 'pushEndpoint is wrong' "$(printf '%s' "$cfg" | grep pushEndpoint)"

  printf '%s' "$cfg" | grep -q "audience: https://${API}" \
    && ok "OIDC audience → https://${API}" \
    || bad 'OIDC audience is wrong' 'must match PUBSUB_PUSH_AUDIENCE on Cloud Run'

  printf '%s' "$cfg" | grep -q 'serviceAccountEmail: gmail-webhook-oidc@' \
    && ok 'OIDC service account → gmail-webhook-oidc@…' \
    || bad 'OIDC service account is wrong or unset'
}

# ── secrets ──────────────────────────────────────────────────────────
# Secrets live in three stores, one per runtime plane, and that is not a
# mistake — Vercel builds on Vercel, GitHub Actions must hold the GCP
# credential it uses to reach GCP, and Cloud Run reads Secret Manager.
# What IS a mistake is a runtime secret parked in the CI store, where the
# app can never read it. That is exactly how RESEND_API_KEY sat unbound
# for a month while the key, the DNS, and the code were all correct.
#
# This group asserts the invariant nothing else does:
#   - every secret the deploy workflow references EXISTS, with a live version
#   - every one of them is actually BOUND on the running revision (no drift)
#   - every secret the CODE requires at boot is bound
#   - billing secrets are bound BEFORE BILLING_ENABLED flips (pre-flip guard)
DEPLOY_WF='.github/workflows/deploy-cloud-run.yml'

# TWO Cloud Run services, each with its own --update-secrets block and its
# own secret needs. Checking only the API greenlights an email-disabled
# WORKER — the worker is what actually sends.
#
# Requirements are per-service AND least-privilege:
#
#   RESEND_API_KEY  → WORKER ONLY. `EmailService` is the Resend client
#     behind the worker's EmailDeliveryPort seam; its only callers are
#     apps/api/src/worker.ts and packages/workers/src/email-send.worker.ts.
#     The HTTP API imports NotificationsModule (for EmailPrefsController and
#     the suppression list), which constructs EmailService — but no API
#     request path ever calls .send(), and construction without the key is
#     fail-closed by design. Binding a live mail-sending credential onto the
#     public, internet-facing service would be exposure with no use.
#
#   RESEND_WEBHOOK_SECRET → API ONLY. Verifies inbound Resend webhook
#     signatures in apps/api/src/webhooks/resend/. The worker serves no HTTP.
#
# Derived from: rg -l 'RESEND_API_KEY|RESEND_WEBHOOK_SECRET' apps/api/src packages
SERVICES='declutrmail-api declutrmail-worker'
required_for() {
  case "$1" in
    declutrmail-api)    echo 'RESEND_WEBHOOK_SECRET' ;;
    declutrmail-worker) echo 'RESEND_API_KEY' ;;
  esac
}
# Only required once billing is live; webhook controllers live in the API.
billing_for() {
  case "$1" in
    declutrmail-api) echo 'PADDLE_WEBHOOK_SECRET RAZORPAY_WEBHOOK_SECRET' ;;
    *)               echo '' ;;
  esac
}

# The --update-secrets block belonging to ONE service: find its
# `gcloud run deploy <svc>` line, take the first --update-secrets after it.
svc_pairs() {
  awk -v svc="$1" '
    $0 ~ ("gcloud run deploy " svc "([[:space:]]|\\\\|$)") { found=1 }
    found && /--update-secrets=/ {
      match($0, /--update-secrets="[^"]*"/)
      s = substr($0, RSTART, RLENGTH)
      sub(/^--update-secrets="/, "", s); sub(/"$/, "", s)
      n = split(s, a, ","); for (i=1; i<=n; i++) if (a[i] != "") print a[i]
      exit
    }
  ' "$DEPLOY_WF" | sort -u
}

svc_live() {
  gcloud run services describe "$1" --project="$GCP_PROJECT" --region="$GCP_REGION" --format=json 2>/dev/null \
    | python3 -c "
import json,sys
try: e=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env']
except Exception: sys.exit(1)
for x in e:
    src = x['valueFrom']['secretKeyRef']['name'] if 'valueFrom' in x else '-'
    print(x['name'], src, x.get('value',''))
" 2>/dev/null
}

check_secrets() {
  group 'secrets — Secret Manager contract vs live revision'

  if ! command -v gcloud >/dev/null 2>&1 || ! gcloud auth print-access-token >/dev/null 2>&1; then
    skip 'secrets checks (gcloud missing, or run `gcloud auth login`)'; return
  fi
  command -v python3 >/dev/null 2>&1 || { skip 'secrets checks (python3 absent)'; return; }
  [ -f "$DEPLOY_WF" ] || { bad "deploy workflow not found at ${DEPLOY_WF}" 'run from the repo root'; return; }

  local sm
  sm=$(gcloud secrets list --project="$GCP_PROJECT" --format='value(name)' 2>/dev/null)
  [ -n "$sm" ] || { bad "could not list Secret Manager secrets in ${GCP_PROJECT}" 'the checks below did NOT run'; return; }

  local svc live pairs envname secid p s row src val
  for svc in $SERVICES; do
    pairs=$(svc_pairs "$svc")
    [ -n "$pairs" ] || { bad "no --update-secrets found for ${svc} in ${DEPLOY_WF}" 'contract unparseable'; continue; }

    live=$(svc_live "$svc")
    [ -n "$live" ] || { bad "could not read the live ${svc} revision" 'its checks did NOT run'; continue; }

    # A. Contract: every referenced secret exists with an ENABLED version.
    #    A referenced-but-missing secret fails the ENTIRE deploy.
    local missing=0 novers=0
    while IFS= read -r p; do
      envname=${p%%=*}; secid=${p#*=}; secid=${secid%%:*}
      if ! printf '%s\n' "$sm" | grep -qx "$secid"; then
        bad "${svc}: deploy references secret '${secid}' (${envname}) which does not exist" 'the next deploy will fail'
        missing=$((missing+1)); continue
      fi
      if [ -z "$(gcloud secrets versions list "$secid" --project="$GCP_PROJECT" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | head -1)" ]; then
        bad "${svc}: secret '${secid}' has no ENABLED version" "${envname} would resolve to nothing"
        novers=$((novers+1))
      fi
    done <<EOF
$pairs
EOF
    [ "$missing" -eq 0 ] && [ "$novers" -eq 0 ] \
      && ok "${svc}: all $(printf '%s\n' "$pairs" | wc -l | tr -d ' ') deploy-referenced secrets exist with a live version"

    # B. Drift: bound on the RUNNING revision, to the SAME secret.
    local drift=0 bound
    while IFS= read -r p; do
      envname=${p%%=*}; secid=${p#*=}; secid=${secid%%:*}
      bound=$(printf '%s\n' "$live" | awk -v n="$envname" '$1==n {print $2}')
      if [ -z "$bound" ]; then
        bad "${svc}: ${envname} is in the deploy contract but NOT bound on the live revision"; drift=$((drift+1))
      elif [ "$bound" != "$secid" ]; then
        bad "${svc}: ${envname} is bound to '${bound}', deploy says '${secid}'"; drift=$((drift+1))
      fi
    done <<EOF
$pairs
EOF
    [ "$drift" -eq 0 ] && ok "${svc}: live revision matches the deploy secret contract (no drift)"

    # C. Secrets THIS service's code needs at boot. "Present" is not enough;
    #    each of these states looks bound and still ships broken mail:
    #      - absent entirely
    #      - a plain env var (plaintext credential, or an empty string)
    #      - bound to a secret with no ENABLED version → resolves to nothing
    #      - bound live but MISSING from the workflow → `--set-env-vars` is a
    #        FULL REPLACE, so the next routine deploy silently wipes it
    for s in $(required_for "$svc"); do
      row=$(printf '%s\n' "$live" | awk -v n="$s" '$1==n {print; exit}')
      if [ -z "$row" ]; then
        # Three situations look identical from the revision's side, and each
        # has a different next action: create the secret / wire it in the
        # workflow / just deploy. Say which.
        local guess; guess=$(printf '%s\n' "$sm" | grep -i "^$(printf '%s' "$s" | tr 'A-Z_' 'a-z-')" | head -1)
        if printf '%s\n' "$pairs" | grep -q "^${s}="; then
          bad "${svc}: ${s} is bound in ${DEPLOY_WF} but this revision predates it" \
              'deploy to apply — email stays disabled until then'
        elif [ -n "$guess" ]; then
          bad "${svc}: ${s} is read by this service's code but NOT bound on the revision" \
              "the secret '${guess}' EXISTS in Secret Manager — it just isn't wired; add it to ${DEPLOY_WF}"
        else
          bad "${svc}: ${s} is read by this service's code but bound NOWHERE" \
              'no matching secret in Secret Manager either — create it, then wire it in the deploy workflow'
        fi
        continue
      fi
      src=$(printf '%s' "$row" | awk '{print $2}'); val=$(printf '%s' "$row" | awk '{print $3}')
      if [ "$src" = '-' ]; then
        [ -z "$val" ] \
          && bad "${svc}: ${s} is bound as an EMPTY plain env var" 'the service fails closed as if it were unset' \
          || bad "${svc}: ${s} is a plain env var, not a Secret Manager reference" 'a credential in plaintext on the revision'
        continue
      fi
      printf '%s\n' "$sm" | grep -qx "$src" || { bad "${svc}: ${s} references secret '${src}' which does not exist"; continue; }
      if [ -z "$(gcloud secrets versions list "$src" --project="$GCP_PROJECT" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | head -1)" ]; then
        bad "${svc}: ${s} references '${src}', which has no ENABLED version" 'it resolves to nothing at boot'; continue
      fi
      printf '%s\n' "$pairs" | grep -q "^${s}=" || {
        bad "${svc}: ${s} is bound live but ABSENT from ${DEPLOY_WF}" \
            'the next deploy full-replaces env vars and will silently wipe it'; continue; }
      ok "${svc}: ${s} → ${src} (bound, live version, durable across deploys)"
    done

    # D. Pre-flip guard: bind billing secrets BEFORE BILLING_ENABLED=true.
    local bsecs billing unbound=''
    bsecs=$(billing_for "$svc")
    if [ -n "$bsecs" ]; then
      billing=$(printf '%s\n' "$live" | awk '$1=="BILLING_ENABLED" {print $3}')
      if [ "$billing" = 'true' ]; then
        for s in $bsecs; do
          printf '%s\n' "$live" | awk -v n="$s" '$1==n' | grep -q . \
            && ok "${svc}: ${s} bound (billing is live)" \
            || bad "${svc}: BILLING_ENABLED=true but ${s} is not bound" 'webhook signature verification will fail'
        done
      else
        for s in $bsecs; do
          printf '%s\n' "$live" | awk -v n="$s" '$1==n' | grep -q . || unbound="${unbound}${s} "
        done
        [ -n "$unbound" ] \
          && warn "${svc}: billing is OFF; bind these before BILLING_ENABLED=true" "${unbound%% }" \
          || ok "${svc}: billing secrets already bound (safe to flip BILLING_ENABLED)"
      fi
    fi
  done

  # F. IAM exposure. The workflow binds each runtime secret to exactly one
  #    service — but a binding is not a boundary. What decides who can READ
  #    a secret is its IAM policy plus which identity each service runs as.
  #    Two failure modes, both invisible to checks A–D:
  #      - the secret grants secretAccessor to an SA that does not own it
  #      - both services share one SA, so no per-secret split can exist
  local api_sa worker_sa
  api_sa=$(gcloud run services describe declutrmail-api --project="$GCP_PROJECT" --region="$GCP_REGION" \
             --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)
  worker_sa=$(gcloud run services describe declutrmail-worker --project="$GCP_PROJECT" --region="$GCP_REGION" \
             --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)

  # WARN, not FAIL. Both IAM findings are long-standing posture with a
  # documented remediation (FOUNDER-FOLLOWUPS.md), not launch blockers and
  # not regressions. A check that can never go green teaches you to ignore
  # the whole run — which costs more than the finding is worth. A red run
  # should mean something broke.
  if [ -z "$api_sa" ] || [ -z "$worker_sa" ]; then
    bad 'could not resolve the Cloud Run runtime service accounts' 'IAM exposure was NOT checked'
  elif [ "$api_sa" = "$worker_sa" ]; then
    warn "both services run as ${api_sa}" \
        'the worker-only / api-only secret split is a convention, not a boundary: the public API can read the mail-sending key. See FOUNDER-FOLLOWUPS.md'
  else
    ok 'declutrmail-api and declutrmail-worker run as distinct service accounts'
  fi

  # Even with a shared SA, a secret readable by any OTHER principal is a
  # separate defect. Two traps here, both of which produce a false PASS:
  #
  #   1. Filtering to `serviceAccount:` drops `allUsers`,
  #      `allAuthenticatedUsers`, `user:`, `group:`, `domain:` — i.e. every
  #      principal type where exposure is WORSE. Consider all of them.
  #   2. Not every role on the policy grants read. `secretmanager.viewer`
  #      sees metadata only; `secretVersionAdder` writes. Filtering on
  #      members alone would falsely FAIL on a harmless viewer grant.
  #
  # Roles that can call accessSecretVersion:
  #   roles/secretmanager.secretAccessor, roles/secretmanager.admin,
  #   roles/owner, roles/editor
  read_capable_role() {
    case "$1" in
      roles/secretmanager.secretAccessor|roles/secretmanager.admin|roles/owner|roles/editor) return 0 ;;
      *) return 1 ;;
    esac
  }

  # IAM INHERITS. `gcloud secrets get-iam-policy` shows only the resource
  # policy; a read-capable role at the PROJECT level grants access to every
  # secret in the project and never appears there. A per-secret check that
  # ignores inheritance is checking a lock on a door with no wall.
  #
  # Human owners/editors are expected (the founder). A SERVICE ACCOUNT with
  # project-wide secret read is not: it makes every per-secret grant — and
  # any future worker/api SA split — decorative.
  check_project_inheritance() {
    local role member sa_wide='' human='' public=''
    while IFS=$'\t' read -r role member; do
      [ -n "$member" ] || continue
      read_capable_role "$role" || continue
      case "$member" in
        allUsers|allAuthenticatedUsers) public="${public}${member}(${role}) " ;;
        serviceAccount:*)               sa_wide="${sa_wide}${member#serviceAccount:}(${role}) " ;;
        *)                              human="${human}${member} " ;;
      esac
    done <<EOF
$(gcloud projects get-iam-policy "$GCP_PROJECT" \
    --flatten='bindings[].members[]' --format='value(bindings.role,bindings.members)' 2>/dev/null)
EOF

    [ -n "$public" ] && bad "project IAM: secrets are readable by ${public%% }" 'anyone can read every secret — revoke now'

    # WARN for the same reason as the shared-SA finding above. `allUsers`
    # below stays a FAIL — that one IS an emergency.
    if [ -n "$sa_wide" ]; then
      PROJECT_WIDE_SA_READ=1
      warn "project IAM: service account(s) can read EVERY secret: ${sa_wide%% }" \
          'inherited project-wide secret read makes per-secret grants (and any api/worker SA split) decorative — see FOUNDER-FOLLOWUPS.md'
    else
      PROJECT_WIDE_SA_READ=0
      ok 'project IAM: no service account has project-wide secret read'
    fi

    [ -n "$human" ] && info_line "project IAM: human admins with inherited secret read: ${human%% }"
    return 0
  }
  # `info` is not part of this script's vocabulary; render as a passing note.
  info_line() { printf '  \033[90mNOTE\033[0m  %s\n' "$1"; }

  check_project_inheritance

  check_secret_readers() {
    local secret=$1 owner_sa=$2 label=$3 role member readers='' extra='' public=''
    gcloud secrets describe "$secret" --project="$GCP_PROJECT" >/dev/null 2>&1 || return 0

    while IFS=$'\t' read -r role member; do
      [ -n "$member" ] || continue
      read_capable_role "$role" || continue
      readers="${readers}${member}"$'\n'
    done <<EOF
$(gcloud secrets get-iam-policy "$secret" --project="$GCP_PROJECT" \
    --flatten='bindings[].members[]' --format='value(bindings.role,bindings.members)' 2>/dev/null)
EOF

    readers=$(printf '%s' "$readers" | sed '/^$/d' | sort -u)
    [ -n "$readers" ] || { bad "${secret}: no principal can read it" 'the service will fail to start'; return 0; }

    while IFS= read -r member; do
      case "$member" in
        allUsers|allAuthenticatedUsers) public="${public}${member} " ;;
        "serviceAccount:${owner_sa}") ;;
        *) extra="${extra}${member} " ;;
      esac
    done <<EOF
$readers
EOF

    if [ -n "$public" ]; then
      bad "${secret}: PUBLICLY READABLE (${public%% })" 'revoke immediately — anyone on the internet can read this secret'
    elif [ -n "$extra" ]; then
      bad "${secret}: readable by a principal that does not own it" "${extra%% } — should be serviceAccount:${owner_sa} only"
    else
      ok "${secret}: readable only by ${label}"
    fi
  }

  # Only meaningful when the identities differ. With one shared SA,
  # "readable only by the worker" and "readable only by the api" name the
  # SAME principal — the check would pass by tautology while the exposure it
  # exists to find is present. Unprovable is not a pass.
  # A resource-level policy only means something when (a) the two services
  # have distinct identities, and (b) nothing inherits project-wide read.
  # Otherwise a PASS here would be a tautology twice over.
  if [ "${PROJECT_WIDE_SA_READ:-0}" = 1 ]; then
    skip 'per-secret reader checks (a service account has project-wide secret read — resource policy is moot)'
  elif [ -z "$api_sa" ] || [ -z "$worker_sa" ]; then
    :  # already failed above
  elif [ "$api_sa" = "$worker_sa" ]; then
    skip 'per-secret reader checks (both services share one SA — ownership is unprovable)'
  else
    check_secret_readers resend-api-key-prod        "$worker_sa" 'the worker (sender)'
    check_secret_readers resend-webhook-secret-prod "$api_sa"    'the api (signature verification)'
  fi

  # E. Hygiene: a runtime secret sitting in the CI store is the bug class.
  if command -v gh >/dev/null 2>&1; then
    local ghs stray='' all
    all=$(for svc in $SERVICES; do required_for "$svc"; billing_for "$svc"; done | tr ' ' '\n' | sed '/^$/d' | sort -u)
    ghs=$(gh secret list 2>/dev/null | awk '{print $1}')
    if [ -n "$ghs" ]; then
      for s in $all; do
        printf '%s\n' "$ghs" | grep -qx "$s" && stray="${stray}${s} "
      done
      [ -n "$stray" ] \
        && warn 'runtime secrets parked in the GitHub Actions store' "${stray%% } — CI never uses these; move to Secret Manager and delete" \
        || ok 'no runtime secrets stranded in the CI store'
    else
      skip 'CI-store hygiene (gh could not list secrets)'
    fi
  else
    skip 'CI-store hygiene (gh absent)'
  fi
}

# ── main ─────────────────────────────────────────────────────────────
SELECTED=("$@")
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=(dns mail web api env pubsub secrets)

printf '\033[1mDeclutrMail launch preflight\033[0m — %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
for g in "${SELECTED[@]}"; do
  case "$g" in
    dns) check_dns ;; mail) check_mail ;; web) check_web ;; api) check_api ;; env) check_env ;; pubsub) check_pubsub ;; secrets) check_secrets ;;
    *) printf '\nunknown group: %s (valid: dns mail web api env pubsub secrets)\n' "$g"; exit 2 ;;
  esac
done

printf '\n\033[1m%d passed · %d failed · %d warned · %d skipped\033[0m\n' "$PASS" "$FAIL" "$WARN" "$SKIP"
[ "$FAIL" -eq 0 ]
