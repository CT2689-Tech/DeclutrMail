import { errors } from 'oidc-provider';
import { describe, expect, it } from 'vitest';

import { applyClientRegistrationPolicy } from './oauth-client-policy.js';

const apply = (metadata: Record<string, unknown>, registering = true) => {
  applyClientRegistrationPolicy(metadata, { registering });
  return metadata;
};

describe('client registration policy', () => {
  it('makes every client public and drops any secret', () => {
    const result = apply({
      token_endpoint_auth_method: 'client_secret_basic',
      client_secret: 'generated-by-the-library',
      client_secret_expires_at: 0,
      redirect_uris: ['https://client.example/cb'],
    });
    expect(result.token_endpoint_auth_method).toBe('none');
    expect(result).not.toHaveProperty('client_secret');
    expect(result).not.toHaveProperty('client_secret_expires_at');
  });

  it('never pins scope at registration', () => {
    expect(apply({ scope: 'claudeai read', redirect_uris: [] })).not.toHaveProperty('scope');
  });

  it.each([
    ['https', ['https://client.example/cb'], 'web'],
    ['https with a port', ['https://client.example:8443/cb'], 'web'],
    ['loopback IPv4', ['http://127.0.0.1:1234/cb'], 'native'],
    ['loopback name', ['http://localhost/cb'], 'native'],
    ['loopback IPv6', ['http://[::1]:9/cb'], 'native'],
    ['https + loopback', ['https://vscode.dev/redirect', 'http://127.0.0.1/'], 'native'],
  ])('accepts %s redirects', (_label, uris, applicationType) => {
    expect(apply({ redirect_uris: uris }).application_type).toBe(applicationType);
  });

  it.each([
    ['plain http to a host', 'http://client.example/cb'],
    ['a host that only starts with localhost', 'http://localhost.attacker.example/cb'],
    ['a loopback address in the userinfo', 'http://127.0.0.1@attacker.example/cb'],
    ['a private-network address', 'http://192.168.1.10/cb'],
    ['a custom scheme', 'cursor://anysphere.cursor-mcp/cb'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
  ])('refuses %s', (_label, uri) => {
    expect(() => apply({ redirect_uris: ['https://client.example/cb', uri] })).toThrow(
      errors.InvalidClientMetadata,
    );
  });

  it('overrides a client that calls itself native without a loopback redirect', () => {
    const result = apply({
      application_type: 'native',
      redirect_uris: ['https://client.example/cb'],
    });
    expect(result.application_type).toBe('web');
  });

  it('leaves malformed redirect input for the library to reject', () => {
    // Runs before the library's own type checks: must not throw a TypeError.
    expect(() => apply({ redirect_uris: 'https://client.example/cb' })).not.toThrow();
    expect(() => apply({ redirect_uris: [42, null, 'not a url'] })).not.toThrow();
    expect(() => apply({})).not.toThrow();
  });

  it('bounds the name and the software fields, and drops what is not a string', () => {
    const result = apply({
      client_name: `  ${'N'.repeat(200)}  `,
      software_id: 'S'.repeat(500),
      software_version: 7,
      redirect_uris: [],
    });
    expect(result.client_name).toHaveLength(80);
    expect(result).not.toHaveProperty('software_id');
    expect(result).not.toHaveProperty('software_version');
    expect(apply({ client_name: '   ', redirect_uris: [] })).not.toHaveProperty('client_name');
    expect(apply({ client_name: 42, redirect_uris: [] }).client_name).toBe(42);
  });
});
