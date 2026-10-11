import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailClickRecorder } from './email-click-recorder';

const { replace, post, params } = vi.hoisted(() => ({
  replace: vi.fn(),
  post: vi.fn().mockResolvedValue({}),
  params: new URLSearchParams(
    'from=lapse&mailbox=00000000-0000-4000-8000-000000000001&utm_source=email&utm_campaign=lapse&keep=1',
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => params,
}));

vi.mock('@/lib/api/client', () => ({
  apiPost: (...args: unknown[]) => post(...args),
}));

describe('EmailClickRecorder', () => {
  beforeEach(() => {
    replace.mockClear();
    post.mockClear();
    for (const key of [...params.keys()]) params.delete(key);
    params.set('from', 'lapse');
    params.set('mailbox', '00000000-0000-4000-8000-000000000001');
    params.set('utm_source', 'email');
    params.set('utm_campaign', 'lapse');
    params.set('keep', '1');
  });

  it('posts once and strips the email params', () => {
    const { rerender } = render(<EmailClickRecorder />);
    rerender(<EmailClickRecorder />);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/v1/analytics/email-click', {
      template: 'lapse',
      mailboxId: '00000000-0000-4000-8000-000000000001',
    });
    expect(replace).toHaveBeenCalledWith('/?keep=1');
    const posted = JSON.stringify(post.mock.calls);
    expect(posted).not.toContain('@');
  });

  it('does not post an address sitting in the mailbox param', () => {
    params.set('mailbox', 'ada@example.com');
    render(<EmailClickRecorder />);
    expect(post).toHaveBeenCalledWith('/api/v1/analytics/email-click', { template: 'lapse' });
    expect(JSON.stringify(post.mock.calls)).not.toContain('@');
    expect(replace).toHaveBeenCalledWith('/?keep=1');
  });
});
