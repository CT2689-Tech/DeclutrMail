-- Failed initial scans only. Incremental failures stay on
-- last_incremental_error_* and do not flip readiness_status.
-- Pseudonymous mailbox ids. No email address.
SELECT
  pss.mailbox_account_id,
  pss.error_code AS error_class,
  pss.initial_recovery_attempts AS recovery_attempts,
  pss.initial_retry_at AS next_deadline,
  (u.onboarded_at IS NOT NULL) AS owner_onboarded
FROM provider_sync_state AS pss
INNER JOIN mailbox_accounts AS ma ON ma.id = pss.mailbox_account_id
INNER JOIN users AS u ON u.id = ma.user_id
WHERE pss.readiness_status = 'failed'
ORDER BY pss.updated_at;
