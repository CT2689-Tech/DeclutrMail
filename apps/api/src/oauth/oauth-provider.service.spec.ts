import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import { grantableScope, OAuthProviderService } from './oauth-provider.service.js';

const db = {} as DrizzleDb;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OAuthProviderService boot', () => {
  it('constructs nothing while MCP_ENABLED is off — no configuration is needed', () => {
    vi.stubEnv('MCP_ENABLED', 'false');
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('JWT_ACCESS_SECRET', undefined);
    expect(() => new OAuthProviderService(db).onModuleInit()).not.toThrow();
  });

  it('fails at boot when enabled without API_URL', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('JWT_ACCESS_SECRET', 'synthetic-access-secret-for-local-test-only');
    expect(() => new OAuthProviderService(db).onModuleInit()).toThrow(/requires API_URL/);
  });

  it('fails at boot when enabled without the session secret its cookie key derives from', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubEnv('JWT_ACCESS_SECRET', undefined);
    expect(() => new OAuthProviderService(db).onModuleInit()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('builds one provider and reuses it', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubEnv('JWT_ACCESS_SECRET', 'synthetic-access-secret-for-local-test-only');
    const service = new OAuthProviderService(db);
    expect(service.provider.issuer).toBe('https://api.example.test');
    expect(service.provider).toBe(service.provider);
  });
});

describe('grantableScope', () => {
  it.each([
    ['read', 'read'],
    ['cleanup read', 'read cleanup'],
    ['read cleanup', 'read cleanup'],
    ['openid read offline_access', 'read'],
    ['openid offline_access', 'read cleanup'],
    ['claudeai', 'read cleanup'],
    ['', 'read cleanup'],
    [undefined, 'read cleanup'],
    ['READ', 'read cleanup'],
  ])('%j → %j', (requested, granted) => {
    expect(grantableScope(requested)).toBe(granted);
  });
});
