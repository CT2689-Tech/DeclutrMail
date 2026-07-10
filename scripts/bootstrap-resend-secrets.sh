#!/usr/bin/env bash
#
# bootstrap-resend-secrets.sh — create the two Resend secrets in GCP Secret
# Manager and grant the Cloud Run runtime SA read access.
#
# Run this AFTER creating the webhook endpoint in Resend:
#   Resend → Webhooks → Add endpoint
#     URL:    https://api.declutrmail.com/api/webhooks/resend
#     Events: email.bounced, email.complained
#   → copy its Signing Secret (whsec_…)
#
# And after minting a SENDING-ACCESS api key (never a full-access one):
#   Resend → API keys → declutrmail-prod-sending → copy (re_…)
#
# Usage:
#   ./scripts/bootstrap-resend-secrets.sh            # prompts for both values
#   ./scripts/bootstrap-resend-secrets.sh --verify   # check state, change nothing
#
# Values are read from an interactive prompt with echo OFF. They are never
# passed as arguments (shell history), never written to a file, and never
# printed — the script only ever reports a value's LENGTH.
#
# Idempotent: re-running adds a new secret VERSION rather than failing. The
# old version stays ENABLED until you disable it, so a bad paste is
# recoverable (`gcloud secrets versions disable`).
#
# After this succeeds, the deploy workflow still needs the bindings:
#   RESEND_API_KEY=resend-api-key-prod:latest            → declutrmail-WORKER
#   RESEND_WEBHOOK_SECRET=resend-webhook-secret-prod:latest → declutrmail-API
# `--set-env-vars` is a FULL REPLACE, so a binding made with
# `gcloud run services update` is wiped by the next deploy. It must live in
# .github/workflows/deploy-cloud-run.yml.
set -uo pipefail

PROJECT=declutrmail-ai-prod
REGION=us-central1
# Each secret is granted to the runtime identity of the service that needs
# it — resolved from Cloud Run, never hardcoded. `RESEND_API_KEY` is the
# worker's; `RESEND_WEBHOOK_SECRET` is the API's.
#
# If both services share one service account, that boundary is UNENFORCEABLE
# at the IAM layer: whoever can read one can read the other. The script says
# so out loud rather than granting to a hardcoded SA and implying a split
# that does not exist.
svc_sa() {
  local sa
  sa=$(gcloud run services describe "$1" --project="$PROJECT" --region="$REGION" \
         --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)
  [ -n "$sa" ] && { printf '%s' "$sa"; return 0; }
  # Cloud Run reports empty when the service uses the default compute SA.
  local num; num=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null)
  [ -n "$num" ] && printf '%s-compute@developer.gserviceaccount.com' "$num"
}

# These are Secret Manager secret NAMES, not values. Never paste a
# credential here — the script prompts for values with echo off precisely
# so they never touch a file, a shell history, or a diff.
API_SECRET=resend-api-key-prod
WEBHOOK_SECRET=resend-webhook-secret-prod

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; }
info() { printf '  \033[90m·\033[0m %s\n' "$1"; }
die()  { bad "$1"; exit 1; }

# Tripwire. If someone pastes a live credential where a secret NAME belongs,
# refuse to run and say so — before the value can reach a log, a diff, or a
# commit. Secret Manager names are lowercase-and-hyphens; credentials are not.
for __v in "$API_SECRET" "$WEBHOOK_SECRET"; do
  case "$__v" in
    re_*|whsec_*)
      bad 'A LIVE CREDENTIAL is pasted into API_SECRET/WEBHOOK_SECRET in this script.'
      bad 'Those variables hold Secret Manager NAMES, not values.'
      bad ''
      bad 'Treat that credential as compromised: rotate it in Resend now, then'
      bad 'restore the names (resend-api-key-prod / resend-webhook-secret-prod)'
      bad 'and re-run. The script prompts for values with echo off.'
      exit 1 ;;
  esac
  case "$__v" in
    *[!a-z0-9-]*) die "invalid Secret Manager name: '${__v}'" ;;
  esac
done
unset __v

secret_exists()  { gcloud secrets describe "$1" --project="$PROJECT" >/dev/null 2>&1; }
enabled_version() {
  gcloud secrets versions list "$1" --project="$PROJECT" \
    --filter='state=ENABLED' --format='value(name)' 2>/dev/null | head -1
}

# A secret that EXISTS is not a secret that WORKS. A truncated paste stores
# fine, enables fine, and is rejected by Resend at the first send. Ask the
# issuer. The key is sent only to Resend, and never printed here.
#
# We probe GET /domains, which a SENDING-ONLY key is not allowed to call —
# and that refusal is itself the proof the key authenticates. Resend's error
# schema (resend.com/docs/api-reference/errors) distinguishes them:
#
#   200                              → valid, full access
#   401 restricted_api_key           → valid, sending-only  ← what we mandate
#   403 invalid_api_key              → wrong key
#   400 validation_error             → key rejected: truncated, malformed, or
#                                      simply not a key of this account. Tested:
#                                      a well-formed random re_… also yields 400.
#
# Treating 401 as failure would reject exactly the least-privilege key this
# script tells you to use.
#
# Classify a key VALUE (passed in memory — never read back from a store, so
# this can gate a write instead of merely auditing one after the fact).
# Prints one of: valid_full | valid_sending | invalid | malformed | unreachable:<code>
classify_resend_key() {
  local key=$1 body code name
  [ -n "$key" ] || { echo malformed; return; }
  body=$(mktemp); code=$(curl -s -o "$body" -w '%{http_code}' --max-time 20 \
           -H "Authorization: Bearer ${key}" https://api.resend.com/domains 2>/dev/null)
  name=$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[a-z_]+"' "$body" 2>/dev/null | head -1 | sed -E 's/.*"([a-z_]+)"$/\1/')

  case "$code" in
    200) RESEND_DOMAINS=$(cat "$body"); rm -f "$body"; echo valid_full; return ;;
    401) rm -f "$body"; [ "$name" = restricted_api_key ] && echo valid_sending || echo invalid; return ;;
    403) rm -f "$body"; echo invalid; return ;;
    400) rm -f "$body"; echo malformed; return ;;
  esac
  rm -f "$body"; echo "unreachable:${code}"
}

# --verify convenience: classify whatever is currently stored.
validate_resend_key() {
  local key; key=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT" 2>/dev/null)
  classify_resend_key "$key"
}

# Is send.declutrmail.com verified? Reads the payload validate_resend_key kept.
resend_domain_status() {
  printf '%s' "${RESEND_DOMAINS:-}" | python3 -c "
import json,sys
try: d=json.load(sys.stdin).get('data',[])
except Exception: sys.exit(0)
for x in d:
    if x.get('name','').startswith('send.declutrmail.com'): print(x.get('status','unknown')); break
" 2>/dev/null
}

# ── verify mode ──────────────────────────────────────────────────────
if [ "${1:-}" = --verify ]; then
  printf '\nResend secrets — current state in %s\n\n' "$PROJECT"
  rc=0
  for s in "$API_SECRET" "$WEBHOOK_SECRET"; do
    if ! secret_exists "$s"; then bad "${s}: does not exist"; rc=1; continue; fi
    v=$(enabled_version "$s")
    [ -n "$v" ] || { bad "${s}: exists but has NO enabled version"; rc=1; continue; }
    info "${s}: exists, enabled version ${v}"
  done

  # Existence proves nothing. Ask Resend whether the key actually works.
  if secret_exists "$API_SECRET" && [ -n "$(enabled_version "$API_SECRET")" ]; then
    case "$(validate_resend_key)" in
      valid_sending)
        ok "${API_SECRET}: Resend accepts this key (sending-only — correct least privilege)"
        info 'domain status needs full access to read; check Resend → Domains shows "Verified"' ;;
      valid_full)
        ok "${API_SECRET}: Resend accepts this key"
        bad 'this key has FULL ACCESS — mint a sending-only key and replace it'
        rc=1
        st=$(resend_domain_status)
        case "$st" in
          verified) ok 'send.declutrmail.com: verified in Resend' ;;
          '')       bad 'send.declutrmail.com: not found in this Resend account'; rc=1 ;;
          *)        bad "send.declutrmail.com: status '${st}' (needs 'verified')"; rc=1 ;;
        esac ;;
      malformed)
        bad "${API_SECRET}: Resend rejects this key — truncated, or not a key of this account"
        info 'run this script with no flag to add a corrected version'
        rc=1 ;;
      invalid)
        bad "${API_SECRET}: Resend REJECTS this key (wrong or revoked)"
        info 'run this script with no flag to add a corrected version'
        rc=1 ;;
      unreachable:*)
        bad "${API_SECRET}: could not reach Resend to validate — key NOT verified"; rc=1 ;;
    esac
  fi
  printf '\nWorkflow bindings (the part this script does NOT do):\n'
  wf=.github/workflows/deploy-cloud-run.yml
  if [ -f "$wf" ]; then
    grep -q "RESEND_API_KEY=${API_SECRET}" "$wf"          && ok "RESEND_API_KEY bound in ${wf}"          || { bad "RESEND_API_KEY not in ${wf} — the next deploy would not set it"; rc=1; }
    grep -q "RESEND_WEBHOOK_SECRET=${WEBHOOK_SECRET}" "$wf" && ok "RESEND_WEBHOOK_SECRET bound in ${wf}" || { bad "RESEND_WEBHOOK_SECRET not in ${wf} — the next deploy would not set it"; rc=1; }
  else
    bad "${wf} not found (run from the repo root)"; rc=1
  fi
  printf '\nThen: ./scripts/launch-preflight.sh secrets api\n\n'
  exit "$rc"
fi

# ── preflight ────────────────────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || die 'gcloud not found'
gcloud auth print-access-token >/dev/null 2>&1 || die 'gcloud not authenticated — run: gcloud auth login'
gcloud projects describe "$PROJECT" >/dev/null 2>&1 || die "cannot access project ${PROJECT}"

printf '\nCreating Resend secrets in \033[1m%s\033[0m\n' "$PROJECT"
printf 'Paste values at the prompts. Input is hidden and never echoed or logged.\n\n'

# ── read + validate ──────────────────────────────────────────────────
# Reject anything that is not exactly the credential: a stray newline or
# space silently breaks auth in a way that looks like a wrong key.
read_secret() {
  local __var=$1 __label=$2 __prefix=$3 __val=''
  printf '  %s (expects %s…): ' "$__label" "$__prefix" >&2
  IFS= read -rs __val; printf '\n' >&2
  [ -n "$__val" ] || die "${__label}: empty"
  case "$__val" in
    *[[:space:]]*) die "${__label}: contains whitespace — re-copy without a trailing newline or space" ;;
  esac
  case "$__val" in
    "${__prefix}"*) ;;
    *) die "${__label}: expected to start with '${__prefix}' — is this the right value?" ;;
  esac
  printf -v "$__var" '%s' "$__val"
}

read_secret RESEND_KEY 'Resend SENDING api key' 're_'
read_secret RESEND_WHSEC 'Resend webhook signing secret' 'whsec_'

info "api key: ${#RESEND_KEY} chars · webhook secret: ${#RESEND_WHSEC} chars"
printf '\n'

# ── validate BEFORE writing ──────────────────────────────────────────
# Storing first and validating after leaves a bad version enabled behind a
# `die`, and — worse — every non-fatal branch used to fall through to the
# success banner. Nothing is written unless Resend accepts the key.
info 'asking Resend to validate the key (the key goes only to its issuer)…'
case "$(classify_resend_key "$RESEND_KEY")" in
  valid_sending)
    ok 'Resend accepts this key (sending-only — correct least privilege)' ;;
  valid_full)
    unset RESEND_KEY RESEND_WHSEC
    bad 'This key has FULL ACCESS: it can delete domains and read every message log.'
    die 'Mint a sending-access key in Resend → API keys, then re-run. Nothing was written.' ;;
  malformed)
    unset RESEND_KEY RESEND_WHSEC
    die 'Resend rejects this key — truncated, or not a key of this account. Nothing was written.' ;;
  invalid)
    unset RESEND_KEY RESEND_WHSEC
    die 'Resend rejects this key (wrong or revoked). Nothing was written.' ;;
  unreachable:*)
    unset RESEND_KEY RESEND_WHSEC
    die 'Could not reach Resend to validate the key. Refusing to store an unverified credential.' ;;
esac
printf '\n'

# ── create + add version ─────────────────────────────────────────────
# Does this exact value already exist as an ENABLED version? Adding it again
# is a no-op that LOOKS like a rotation: version number climbs, `latest`
# changes, and the compromised credential stays live at the issuer. A script
# whose stated job is rotation must refuse to fake one.
value_already_stored() {
  local name=$1 value=$2 v cur
  secret_exists "$name" || return 1
  for v in $(gcloud secrets versions list "$name" --project="$PROJECT" \
               --filter='state=ENABLED' --format='value(name)' 2>/dev/null); do
    cur=$(gcloud secrets versions access "$v" --secret="$name" --project="$PROJECT" 2>/dev/null)
    [ "$cur" = "$value" ] && { printf '%s' "$v"; return 0; }
  done
  return 1
}

# Refuse BOTH-or-NEITHER, before either is written. Checking duplicates
# inside put_secret meant a new key could be stored and the run then abort
# on a duplicate webhook secret — a half-rotation, with nothing saying which
# half. The two credentials are one atomic change; gate them together.
assert_not_duplicates() {
  local dup_key dup_whsec failed=0
  dup_key=$(value_already_stored "$API_SECRET" "$1") && failed=1
  dup_whsec=$(value_already_stored "$WEBHOOK_SECRET" "$2") && failed=1
  [ "$failed" -eq 0 ] && return 0

  if [ "${ALLOW_DUPLICATE:-0}" = 1 ]; then
    [ -n "$dup_key" ]   && info "${API_SECRET}: identical to enabled version ${dup_key} — storing anyway (ALLOW_DUPLICATE=1)"
    [ -n "$dup_whsec" ] && info "${WEBHOOK_SECRET}: identical to enabled version ${dup_whsec} — storing anyway (ALLOW_DUPLICATE=1)"
    return 0
  fi

  [ -n "$dup_key" ]   && bad "${API_SECRET}: value is IDENTICAL to enabled version ${dup_key}"
  [ -n "$dup_whsec" ] && bad "${WEBHOOK_SECRET}: value is IDENTICAL to enabled version ${dup_whsec}"
  bad ''
  bad 'That is not a rotation. Storing it again bumps the version number while'
  bad 'the old credential stays live at the issuer — the exposure is unchanged.'
  bad ''
  bad 'To rotate: revoke the credential in Resend, mint a new one, re-run.'
  bad "To store a duplicate deliberately: ALLOW_DUPLICATE=1 $0"
  bad ''
  bad 'Nothing was written. Both credentials are still as they were.'
  exit 1
}

put_secret() {
  local name=$1 value=$2 grantee=$3
  if secret_exists "$name"; then
    info "${name}: exists — adding a new version"
  else
    gcloud secrets create "$name" --project="$PROJECT" --replication-policy=automatic >/dev/null 2>&1 \
      || die "${name}: create failed"
    ok "${name}: created"
  fi

  # printf, not echo: echo appends a newline and Resend rejects the key.
  printf '%s' "$value" | gcloud secrets versions add "$name" --project="$PROJECT" --data-file=- >/dev/null 2>&1 \
    || die "${name}: adding a version failed"

  local v; v=$(enabled_version "$name")
  [ -n "$v" ] || die "${name}: no ENABLED version after add"
  ok "${name}: version ${v} enabled"

  gcloud secrets add-iam-policy-binding "$name" --project="$PROJECT" \
    --member="serviceAccount:${grantee}" --role=roles/secretmanager.secretAccessor >/dev/null 2>&1 \
    || die "${name}: granting secretAccessor to ${grantee} failed"
  ok "${name}: ${grantee} can read it"
}

# Gate both, then write both. Never write one and abort on the other.
assert_not_duplicates "$RESEND_KEY" "$RESEND_WHSEC"

# Grant each secret to the identity of the service that reads it.
API_SA=$(svc_sa declutrmail-api)
WORKER_SA=$(svc_sa declutrmail-worker)
[ -n "$API_SA" ] && [ -n "$WORKER_SA" ] || die 'could not resolve the Cloud Run runtime service accounts'

if [ "$API_SA" = "$WORKER_SA" ]; then
  bad "Both services run as ${API_SA}."
  bad 'The worker-only / api-only split in the deploy workflow is therefore NOT'
  bad 'enforced at the IAM layer: the public API can read the mail-sending key.'
  bad 'Give the worker its own service account to close this. Proceeding —'
  bad 'the grant below is no worse than the status quo, but it is not a boundary.'
  printf '\n'
fi

put_secret "$API_SECRET"     "$RESEND_KEY"   "$WORKER_SA"   # sender
put_secret "$WEBHOOK_SECRET" "$RESEND_WHSEC" "$API_SA"      # signature verification

unset RESEND_KEY RESEND_WHSEC

# ── confirm the stored bytes round-trip ──────────────────────────────
# The key was already validated with Resend BEFORE it was written, so this
# is not "does the key work" — it is "did Secret Manager store exactly what
# we handed it". A value that picked up a newline still fails at send.
printf '\n'
n=$(gcloud secrets versions access latest --secret="$WEBHOOK_SECRET" --project="$PROJECT" 2>/dev/null | wc -c | tr -d ' ')
[ "${n:-0}" -gt 0 ] || die "${WEBHOOK_SECRET}: latest version is empty"
ok "${WEBHOOK_SECRET}: latest version readable, ${n} bytes"

n=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT" 2>/dev/null | wc -c | tr -d ' ')
[ "${n:-0}" -gt 0 ] || die "${API_SECRET}: latest version is empty"
ok "${API_SECRET}: latest version readable, ${n} bytes"

case "$(validate_resend_key)" in
  valid_sending) ok "${API_SECRET}: stored value re-validated against Resend" ;;
  *) die "${API_SECRET}: the STORED value fails validation though the pasted one passed — Secret Manager mangled it (disable this version and re-run)" ;;
esac

cat <<EOF

Secrets are in place. They are NOT yet wired to Cloud Run.

Next, in one PR to .github/workflows/deploy-cloud-run.yml:
  • add  RESEND_API_KEY=${API_SECRET}:latest            to declutrmail-WORKER's --update-secrets
  • add  RESEND_WEBHOOK_SECRET=${WEBHOOK_SECRET}:latest to declutrmail-API's    --update-secrets

Do NOT bind these with 'gcloud run services update' — the workflow's
--set-env-vars is a full replace and would wipe them on the next deploy.

Then verify:
  ./scripts/bootstrap-resend-secrets.sh --verify
  ./scripts/launch-preflight.sh secrets api

Finally, remove the now-duplicated runtime secret from the CI store:
  gh secret delete RESEND_API_KEY
EOF
