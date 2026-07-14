import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectMailboxStartUrl,
  reactivateMailboxStartUrl,
  startMailboxConnect,
  startMailboxReactivation,
} from './connect-mailbox-url';

describe('connectMailboxStartUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('builds the normal connect URL without a reconnect hint', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');

    expect(connectMailboxStartUrl()).toBe(
      'https://api.example.test/api/auth/google/connect-mailbox/start',
    );
  });

  it('encodes the opaque reconnect target', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');

    expect(connectMailboxStartUrl('mailbox/id with ? &')).toBe(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reconnectMailboxId=mailbox%2Fid%20with%20%3F%20%26',
    );
  });

  it('hard-navigates to the targeted OAuth URL', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxConnect('11111111-1111-4111-8111-111111111111');

    expect(assign).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reconnectMailboxId=11111111-1111-4111-8111-111111111111',
    );
    assign.mockRestore();
  });

  it('encodes a disconnected mailbox as a distinct reactivation target', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');

    expect(reactivateMailboxStartUrl('mailbox/id with ? &')).toBe(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reactivateMailboxId=mailbox%2Fid%20with%20%3F%20%26',
    );
  });

  it('hard-navigates to the mailbox-bound reactivation URL', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxReactivation('33333333-3333-4333-8333-333333333333');

    expect(assign).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reactivateMailboxId=33333333-3333-4333-8333-333333333333',
    );
    assign.mockRestore();
  });
});
