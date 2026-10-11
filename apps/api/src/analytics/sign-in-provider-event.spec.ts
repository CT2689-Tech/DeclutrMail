import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { signInProviderKind } from '../auth/sign-in-provider.js';
import { recordSignInProvider } from './record-connect-funnel.js';

describe('signInProviderKind', () => {
  it('treats a non-empty hd as Workspace and never returns the domain', () => {
    const kind = signInProviderKind({ email: 'owner@gmail.com', hostedDomain: 'corp.example' });
    expect(kind).toBe('workspace');
    expect(JSON.stringify(kind)).not.toContain('corp.example');
    expect(signInProviderKind({ email: 'me@corp.example', hostedDomain: '  corp.example  ' })).toBe(
      'workspace',
    );
  });

  it('classifies consumer Gmail only when hd is absent', () => {
    expect(signInProviderKind({ email: 'Owner@Gmail.com' })).toBe('gmail');
    expect(signInProviderKind({ email: 'owner@googlemail.com', hostedDomain: '   ' })).toBe(
      'gmail',
    );
  });

  it('omits an address that is neither hosted nor consumer Gmail', () => {
    expect(signInProviderKind({ email: 'me@example.com' })).toBeNull();
    expect(signInProviderKind({ email: 'me@example.com', hostedDomain: '' })).toBeNull();
  });
});

describe('recordSignInProvider', () => {
  it('writes the closed kind and drops a missing kind', () => {
    const record = vi.fn();
    recordSignInProvider({ record }, 'user-1', 'workspace');
    recordSignInProvider({ record }, 'user-1', null);
    recordSignInProvider({ record }, 'user-1', undefined);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('signin_provider', { kind: 'workspace' }, 'user-1');
    expect(JSON.stringify(record.mock.calls)).not.toContain('@');
  });
});

describe('OAuth callback emits signin_provider', () => {
  it('records the kind on connect, login, and returning sign-in', () => {
    const source = readFileSync(
      new URL('../auth/google-oauth.controller.ts', import.meta.url),
      'utf8',
    );
    const calls = source.match(/recordSignInProvider\(this\.productEvents/g) ?? [];
    expect(calls).toHaveLength(3);
  });
});
