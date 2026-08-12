import { describe, expect, it } from 'vitest';

import { toSessionPoolUrl } from './session-pool-url';

describe('toSessionPoolUrl', () => {
  it('rewrites the Supabase transaction pooler port to the session pooler', () => {
    expect(
      toSessionPoolUrl('postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres'),
    ).toBe('postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres');
  });

  it('leaves a direct connection untouched', () => {
    expect(toSessionPoolUrl('postgresql://postgres:pw@localhost:5432/declutrmail')).toBe(
      'postgresql://postgres:pw@localhost:5432/declutrmail',
    );
    expect(toSessionPoolUrl('postgresql://u:p@db.abcdefref.supabase.co:5432/postgres')).toBe(
      'postgresql://u:p@db.abcdefref.supabase.co:5432/postgres',
    );
  });

  it('leaves a session-pooler DSN untouched', () => {
    expect(
      toSessionPoolUrl('postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres'),
    ).toBe('postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres');
  });

  it('does not rewrite a 6543 port on a non-Supabase host', () => {
    expect(toSessionPoolUrl('postgresql://u:p@my-proxy.internal:6543/db')).toBe(
      'postgresql://u:p@my-proxy.internal:6543/db',
    );
  });
});
