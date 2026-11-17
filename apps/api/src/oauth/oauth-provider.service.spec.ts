import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import type { SecurityEventsService } from '../security-events/security-events.service.js';
import { grantableScope, OAuthProviderService } from './oauth-provider.service.js';

const db = {} as DrizzleDb;
const securityEvents = { record: vi.fn() } as unknown as SecurityEventsService;
const service = () => new OAuthProviderService(db, securityEvents);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OAuthProviderService boot', () => {
  it('constructs nothing while MCP_ENABLED is off — no configuration is needed', () => {
    vi.stubEnv('MCP_ENABLED', 'false');
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('JWT_ACCESS_SECRET', undefined);
    expect(() => service().onModuleInit()).not.toThrow();
  });

  it('fails at boot when enabled without API_URL', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('JWT_ACCESS_SECRET', 'synthetic-access-secret-for-local-test-only');
    expect(() => service().onModuleInit()).toThrow(/requires API_URL/);
  });

  it('fails at boot when enabled without the session secret its cookie key derives from', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubEnv('JWT_ACCESS_SECRET', undefined);
    expect(() => service().onModuleInit()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('builds one provider and reuses it', () => {
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubEnv('JWT_ACCESS_SECRET', 'synthetic-access-secret-for-local-test-only');
    const built = service();
    expect(built.provider.issuer).toBe('https://api.example.test');
    expect(built.provider).toBe(built.provider);
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
