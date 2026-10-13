import { describe, expect, it } from 'vitest';

import { OVERLAY_Z } from './overlay-layers';

describe('OVERLAY_Z', () => {
  it('keeps open modals above the cookie banner and below toasts', () => {
    expect(OVERLAY_Z.modal).toBeGreaterThan(OVERLAY_Z.cookieBanner);
    expect(OVERLAY_Z.sheet).toBeGreaterThan(OVERLAY_Z.modal);
    expect(OVERLAY_Z.toast).toBeGreaterThan(OVERLAY_Z.sheet);
  });
});
