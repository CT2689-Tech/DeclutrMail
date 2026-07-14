import { describe, expect, it, vi } from 'vitest';

const { permanentRedirectSpy } = vi.hoisted(() => ({ permanentRedirectSpy: vi.fn() }));

vi.mock('next/navigation', () => ({
  permanentRedirect: permanentRedirectSpy,
}));

import SnoozedCompatibilityPage from './page';

describe('/snoozed compatibility route (D245)', () => {
  it('permanently redirects old links to canonical /later', () => {
    SnoozedCompatibilityPage();
    expect(permanentRedirectSpy).toHaveBeenCalledWith('/later');
  });
});
