import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { backlogAfterUnsubFailureCopy } from './bulk-action-copy';

/** A failure as the API writes it (`AllExceptionsFilter`). */
function apiError(status: number, code: string): ApiError {
  return new ApiError(
    status,
    { error: { code, message: code } },
    `POST /api/actions failed: ${status}`,
  );
}
/** A refusal: the API answered before anything started. */
const refused = apiError(400, 'VALIDATION_FAILED');

// The request itself stands (D58: it cannot be recalled), so neither
// branch may say "nothing changed" or call the unsubscribe "started".
describe('backlogAfterUnsubFailureCopy', () => {
  it('says the older email did not move only when the enqueue was refused', () => {
    expect(
      backlogAfterUnsubFailureCopy({ verb: 'Archive', senderName: 'Acme', error: refused }),
    ).toBe(
      "Unsubscribe request recorded, but older email from Acme wasn't archived — Archive it separately.",
    );
    expect(backlogAfterUnsubFailureCopy({ verb: 'Delete', error: refused })).toBe(
      "Unsubscribe requests recorded, but older email wasn't deleted — Delete it separately.",
    );
  });

  it('sends a start it cannot confirm to Activity before a retry', () => {
    for (const error of [apiError(503, 'ENQUEUE_FAILED'), new TypeError('Failed to fetch')]) {
      expect(backlogAfterUnsubFailureCopy({ verb: 'Delete', senderName: 'Acme', error })).toBe(
        "Unsubscribe request recorded, but can't tell if Delete started for older email from Acme — check Activity before retrying.",
      );
    }
  });
});
