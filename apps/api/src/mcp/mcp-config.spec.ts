import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  apiPublicUrl,
  mcpAllowedFor,
  mcpEnabled,
  mcpResourceUrl,
  oauthIssuer,
} from './mcp-config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MCP_ENABLED', () => {
  it.each([
    ['true', true],
    ['TRUE', false],
    ['1', false],
    ['yes', false],
    [' true', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (value, expected) => {
    vi.stubEnv('MCP_ENABLED', value);
    expect(mcpEnabled()).toBe(expected);
  });
});

describe('API_URL as the OAuth issuer', () => {
  it('is the origin, with /mcp as the one resource', () => {
    vi.stubEnv('API_URL', 'https://api.declutrmail.com');
    expect(oauthIssuer()).toBe('https://api.declutrmail.com');
    expect(mcpResourceUrl()).toBe('https://api.declutrmail.com/mcp');
  });

  it('accepts a trailing slash and plain http on localhost', () => {
    vi.stubEnv('API_URL', 'http://localhost:4000/');
    expect(oauthIssuer()).toBe('http://localhost:4000');
  });

  it.each([
    ['missing', undefined, /requires API_URL/],
    ['plain http to a real host', 'http://api.declutrmail.com', /must be https/],
    ['a path', 'https://api.declutrmail.com/v1', /no path/],
    ['a query', 'https://api.declutrmail.com/?x=1', /no path/],
  ])('refuses %s', (_label, value, message) => {
    vi.stubEnv('API_URL', value);
    expect(() => apiPublicUrl()).toThrow(message);
  });
});

describe('MCP_ENABLED=beta', () => {
  const listed = '0198d95f-a409-7000-8000-000000000001';
  const other = '0198d95f-a409-7000-8000-000000000002';

  it('opens the routes, but only for the listed user ids', () => {
    vi.stubEnv('MCP_ENABLED', 'beta');
    vi.stubEnv('MCP_BETA_USER_IDS', `${listed}, ${other.toUpperCase()}`);
    expect(mcpEnabled()).toBe(true);
    expect(mcpAllowedFor(listed)).toBe(true);
    expect(mcpAllowedFor(other)).toBe(true);
    vi.stubEnv('MCP_BETA_USER_IDS', listed);
    expect(mcpAllowedFor(other)).toBe(false);
    // The deploy's env list is comma-delimited: several ids go space-separated.
    vi.stubEnv('MCP_BETA_USER_IDS', `${listed} ${other};`);
    expect(mcpAllowedFor(listed)).toBe(true);
    expect(mcpAllowedFor(other)).toBe(true);
  });

  it.each([[''], [undefined], [' , ']])('an empty list (%j) lets nobody in', (list) => {
    vi.stubEnv('MCP_ENABLED', 'beta');
    vi.stubEnv('MCP_BETA_USER_IDS', list);
    expect(mcpAllowedFor(listed)).toBe(false);
  });

  it('lets everyone in when on, and nobody when off, whatever the list says', () => {
    vi.stubEnv('MCP_BETA_USER_IDS', listed);
    vi.stubEnv('MCP_ENABLED', 'true');
    expect(mcpAllowedFor(other)).toBe(true);
    vi.stubEnv('MCP_ENABLED', 'false');
    expect(mcpAllowedFor(listed)).toBe(false);
    expect(mcpEnabled()).toBe(false);
    vi.stubEnv('MCP_ENABLED', 'Beta');
    expect(mcpEnabled()).toBe(false);
  });
});
