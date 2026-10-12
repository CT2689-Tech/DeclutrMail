-- Rows already sitting on `failed` with a reconnect-class grant are the
-- same terminal state 0087 added. Move them so the reconciler and the
-- retry path stop rechecking a grant the user has to reconnect.
-- Indexed mail, the history cursor, and the error code stay. No email.
UPDATE "provider_sync_state"
SET "readiness_status" = 'needs_reconnect',
    "initial_retry_at" = NULL
WHERE "readiness_status" = 'failed'
  AND "error_code" IN ('InvalidGrantError', 'AuthExpiredError', 'ProviderPermissionError');
