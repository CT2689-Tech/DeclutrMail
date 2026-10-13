import { describe, expect, it } from 'vitest';

import { homePreviewEnabled } from './home-preview-access';

describe('homePreviewEnabled', () => {
  it('opens on a Vercel preview and on local development', () => {
    expect(homePreviewEnabled({ vercelEnv: 'preview', nodeEnv: 'production' })).toBe(true);
    expect(homePreviewEnabled({ vercelEnv: undefined, nodeEnv: 'development' })).toBe(true);
    expect(homePreviewEnabled({ vercelEnv: undefined, nodeEnv: 'test' })).toBe(true);
  });

  it('stays closed on a production deploy', () => {
    expect(homePreviewEnabled({ vercelEnv: 'production', nodeEnv: 'production' })).toBe(false);
    expect(homePreviewEnabled({ vercelEnv: undefined, nodeEnv: 'production' })).toBe(false);
  });
});
