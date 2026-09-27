#!/usr/bin/env bash
#
# Install the Atlas CLI that CI uses to lint and apply migrations (D152).
#
# Downloads the COMMUNITY build of one pinned version and checks it against
# a pinned SHA-256 before it ever runs, because this binary applies
# production migrations (.github/workflows/migration-apply.yml).
#
#   * Community build: since v0.38 the default Atlas build runs
#     `atlas migrate lint` only for paid Atlas Pro users
#     (https://atlasgo.io/blog-v038#change-in-v038-atlas-migrate-lint). The
#     community build is compiled from the same open-source repo (Apache-2.0)
#     and needs no account.
#   * The pin expires. Ariga's supported-version policy removes binaries
#     published more than 6 months ago from its download hosts
#     (https://atlasgo.io/cli-reference#supported-version-policy); v1.3.0
#     was published 2026-08-02. When it is gone this script fails below.
#     Bump ATLAS_VERSION and both checksums in one change — Ariga publishes
#     each checksum next to its binary, at <binary URL>.sha256.
#
# Usage: scripts/install-atlas.sh <install-dir>
set -euo pipefail

ATLAS_VERSION=v1.3.0
SHA256_LINUX_AMD64=10d7913e3dce43ab99b8d71534a4cbadaf11a16dc293adf3b91d10e83a0ac70b
SHA256_DARWIN_ARM64=4e5ffdc10b2b4fd3a06074aba72848150907d5316cacad7b19bae6c6ae3db991

dest="${1:?usage: $0 <install-dir>}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-amd64 want=$SHA256_LINUX_AMD64 ;;
  Darwin-arm64) platform=darwin-arm64 want=$SHA256_DARWIN_ARM64 ;;
  *)
    echo "install-atlas: no pinned checksum for $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

file="atlas-community-$platform-$ATLAS_VERSION"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# The same two Ariga hosts, in the same order, as Ariga's own installer.
fetched=
for host in https://atlasbinaries.com/atlas https://release.ariga.io/atlas; do
  if curl -fsSL --retry 3 --connect-timeout 20 --max-time 300 -o "$tmp" "$host/$file"; then
    fetched=$host
    break
  fi
  echo "install-atlas: could not fetch $host/$file" >&2
done
if [ -z "$fetched" ]; then
  echo "install-atlas: $file is unavailable from both Ariga hosts. If Ariga has" >&2
  echo "retired $ATLAS_VERSION, bump ATLAS_VERSION and both checksums in $0." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  got="$(sha256sum "$tmp" | cut -d' ' -f1)"
else
  got="$(shasum -a 256 "$tmp" | cut -d' ' -f1)"
fi
if [ "$got" != "$want" ]; then
  echo "install-atlas: checksum mismatch for $fetched/$file" >&2
  echo "  expected $want" >&2
  echo "  got      $got" >&2
  exit 1
fi

mkdir -p "$dest"
install -m 0755 "$tmp" "$dest/atlas"
echo "install-atlas: installed $file from $fetched (sha256 verified)"
"$dest/atlas" version
