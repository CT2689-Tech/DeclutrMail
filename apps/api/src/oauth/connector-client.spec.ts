import { describe, expect, it } from 'vitest';

import { connectorClient } from './connector-client.js';

describe('connectorClient', () => {
  it.each([
    [['https://claude.ai/api/mcp/auth_callback'], 'claude'],
    [['https://claude.com/api/mcp/auth_callback'], 'claude'],
    [['https://chatgpt.com/connector_platform_oauth_redirect'], 'chatgpt'],
    [['http://127.0.0.1:33418/callback'], 'local'],
    [['http://localhost:6274/oauth/callback'], 'local'],
    [['http://[::1]:8080/cb'], 'local'],
    [['cursor://anysphere.cursor-retrieval/oauth/callback'], 'local'],
    [['https://client.example/callback'], 'other'],
    [[], 'other'],
    [['not a url'], 'other'],
  ] as const)('%j is %s', (uris, family) => {
    expect(connectorClient(uris)).toBe(family);
  });

  it('is fooled by neither a look-alike host nor plain http', () => {
    expect(connectorClient(['https://claude.ai.evil.example/cb'])).toBe('other');
    expect(connectorClient(['https://notclaude.ai/cb'])).toBe('other');
    expect(connectorClient(['http://claude.ai/cb'])).toBe('other');
  });

  it('a mixed registration is "other", never the friendlier name', () => {
    expect(
      connectorClient(['https://claude.ai/api/mcp/auth_callback', 'https://client.example/cb']),
    ).toBe('other');
  });
});
