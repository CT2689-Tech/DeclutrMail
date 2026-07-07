// Pins the ADR-0016 A5 verb→tone lock for the lead CTA on the Senders
// list surfaces (card + table row via `SenderActionRow`). Guards the
// drift the design-system-agent flagged on PR #263: Keep rendered
// `dark` (colliding with Archive's tone) and Delete rendered `warn`
// (colliding with Unsubscribe's amber).

import { describe, expect, it } from 'vitest';
import { leadButtonTone } from './action-row';

describe('leadButtonTone — ADR-0016 A5 tone lock', () => {
  it.each([
    ['Keep', 'primary'],
    ['Archive', 'dark'],
    ['Unsubscribe', 'warn'],
    ['Later', 'default'],
    ['Delete', 'danger'],
  ] as const)('%s → %s', (verb, tone) => {
    expect(leadButtonTone(verb)).toBe(tone);
  });
});
