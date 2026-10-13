import { describe, expect, it } from 'vitest';

import {
  COOKIE_BANNER_CLEARANCE_PX,
  COOKIE_BANNER_LIFT_VAR,
  OVERLAY_Z,
  bottomClearOfCookieBanner,
  cookieBannerLiftPx,
} from './overlay-layers';

describe('OVERLAY_Z', () => {
  it('keeps open modals above the cookie banner and below toasts', () => {
    expect(OVERLAY_Z.modal).toBeGreaterThan(OVERLAY_Z.cookieBanner);
    expect(OVERLAY_Z.sheet).toBeGreaterThan(OVERLAY_Z.modal);
    expect(OVERLAY_Z.toast).toBeGreaterThan(OVERLAY_Z.sheet);
  });
});

describe('cookie banner clearance', () => {
  it('adds the banner height plus a gap', () => {
    expect(cookieBannerLiftPx(220)).toBe(220 + COOKIE_BANNER_CLEARANCE_PX);
  });

  it('adds that lift to a bottom anchor, and adds nothing when the banner is absent', () => {
    expect(bottomClearOfCookieBanner('16px + var(--dm-tabbar-inset, 0px)')).toBe(
      `calc(16px + var(--dm-tabbar-inset, 0px) + var(${COOKIE_BANNER_LIFT_VAR}, 0px))`,
    );
  });
});
