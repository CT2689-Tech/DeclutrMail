#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
node_bin="$(command -v node)"
deadline="$repo_root/scripts/ci-command-deadline.mjs"
playwright_cli="$(pnpm --filter @declutrmail/e2e exec node -p 'require.resolve("@playwright/test/cli")')"
dependencies_ready=0
status=1

for attempt in 1 2 3; do
  started=$SECONDS
  if (( dependencies_ready == 0 )); then
    # A slow Azure package mirror can consume every retry on the same fonts.
    # Only after a failed attempt, switch the hosted x64 runner's known origin;
    # APT sources, priorities, signing keys and the work budget stay intact.
    if (( attempt == 2 )) && [[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux ]]; then
      mirror_command=(env GITHUB_ACTIONS=true RUNNER_OS=Linux "$node_bin" "$deadline" 5000 15000 "$node_bin" "$repo_root/scripts/ci-ubuntu-mirrors.mjs")
      if [[ "$(id -u)" != 0 ]]; then
        mirror_command=(sudo -n "${mirror_command[@]}")
      fi
      "${mirror_command[@]}"
    fi
    # The watchdog must own the same privileges as apt. Running Playwright as
    # root avoids its nested sudo, which the outer user cannot reliably stop.
    dependency_ms=$((240000 - (SECONDS - started) * 1000))
    if (( dependency_ms <= 0 )); then exit 124; fi
    dependency_command=("$node_bin" "$deadline" "$dependency_ms" 15000 "$node_bin" "$playwright_cli" install-deps chromium)
    if [[ "$(id -u)" != 0 ]]; then
      dependency_command=(sudo -n "${dependency_command[@]}")
    fi
    if "${dependency_command[@]}"; then
      dependencies_ready=1
    else
      status=$?
      echo "::warning::Chromium system dependencies attempt $attempt failed (exit $status)"
    fi
  fi

  # System packages and browser download share the existing four-minute work
  # budget. Only the bounded process-group cleanup grace extends that deadline.
  remaining_ms=$((240000 - (SECONDS - started) * 1000))
  if (( dependencies_ready == 1 && remaining_ms > 0 )); then
    # Browser files remain owned by the runner user, never by root.
    if "$node_bin" "$deadline" "$remaining_ms" 15000 "$node_bin" "$playwright_cli" install chromium; then
      exit 0
    else
      status=$?
      echo "::warning::Chromium browser download attempt $attempt failed (exit $status)"
    fi
  fi
  if (( attempt < 3 )); then sleep "$((attempt * 15))"; fi
done

echo "::error::Chromium prerequisite installation failed after 3 bounded attempts"
exit "$status"
