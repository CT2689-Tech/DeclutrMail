#!/usr/bin/env bash
# Read-only audit of intended gates, live protection/rulesets and queue triggers.
set -euo pipefail
node "$(dirname "${BASH_SOURCE[0]}")/check-merge-queue-ready.mjs" "$@"
