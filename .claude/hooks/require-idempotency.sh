#!/usr/bin/env bash
# require-idempotency.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Enforces D203 + D225: every worker class extending BaseDeclutrWorker
# must declare an idempotencyKey (field, getter, or method). Webhook
# handlers must dedupe on the external message ID; per-mailbox workers
# must key on (mailbox_id, gmail_message_id) or equivalent.
#
# Exit 1 if a worker class is missing the key.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  *.ts|*.tsx)
    ;;
  *)
    exit 0
    ;;
esac

case "$file_path" in
  */.claude/*|*/docs/*|*/.github/*|*.test.ts|*.spec.ts|*/__tests__/*)
    exit 0
    ;;
esac

# Only relevant for files declaring a worker class
if ! grep -qE "extends\s+BaseDeclutrWorker" "$file_path"; then
  exit 0
fi

# Idempotency declaration patterns:
#   - `idempotencyKey: <something>` (field)
#   - `idempotencyKey(...)` (method)
#   - `get idempotencyKey()` (getter)
#   - `@IdempotencyKey(...)` (decorator)
if ! grep -qE "(idempotencyKey\s*[:=(]|get\s+idempotencyKey\s*\(|@IdempotencyKey)" "$file_path"; then
  echo "❌ require-idempotency: worker class missing idempotencyKey declaration" >&2
  echo "   File: $file_path" >&2
  echo "" >&2
  echo "   Per D203 + D225, every BaseDeclutrWorker subclass declares an idempotency key:" >&2
  echo "   - webhookPolicy: key on the webhook event id (Pub/Sub messageId, Stripe event.id, ...)" >&2
  echo "   - perMailboxPolicy: key on (mailbox_id, gmail_message_id) or equivalent" >&2
  echo "   - batchPolicy: key on the batch's deterministic identifier" >&2
  echo "   - cronPolicy: key on the run timestamp window" >&2
  echo "   - adminPolicy: key on the admin operation id" >&2
  exit 1
fi

exit 0
