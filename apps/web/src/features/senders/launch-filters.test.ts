import { describe, expect, it } from 'vitest';
import { parseSendersScope } from './api/senders-scope';
import { composeForLaunchFilter, launchFilterSearch, LAUNCH_FILTERS } from './launch-filters';
import { sendersFixSetHref } from './routes';

describe('launch filters', () => {
  it('round-trips each saved filter through the senders URL', () => {
    for (const filter of LAUNCH_FILTERS) {
      const parsed = parseSendersScope(new URLSearchParams(launchFilterSearch(filter.id)));
      expect(parsed.compose).toMatchObject(composeForLaunchFilter(filter.id));
    }
  });

  it('keeps fix-set ids in order', () => {
    expect(sendersFixSetHref(['b', 'a'])).toBe('/senders?fix=b&fix=a');
    expect(sendersFixSetHref([])).toBe('/senders');
  });
});
