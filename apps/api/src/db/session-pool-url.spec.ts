import { describe, expect, it } from 'vitest';

import { safeHostPort, toSessionPoolUrl } from './session-pool-url';

describe('toSessionPoolUrl', () => {
  it('rewrites the Supabase transaction pooler port to the session pooler', () => {
    expect(
      toSessionPoolUrl('postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres'),
    ).toBe('postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres');
  });

  it('rewrites a path-less / query-only pooler DSN (postgres.js accepts these)', () => {
    expect(toSessionPoolUrl('postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543')).toContain(
      '.pooler.supabase.com:5432',
    );
    expect(
      toSessionPoolUrl(
        'postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres?sslmode=require',
      ),
    ).toBe('postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require');
  });

  it('rewrites the legacy db.<ref>.supabase.co:6543 PgBouncer shape and uppercase hosts', () => {
    expect(toSessionPoolUrl('postgresql://u:p@db.abcdefref.supabase.co:6543/postgres')).toBe(
      'postgresql://u:p@db.abcdefref.supabase.co:5432/postgres',
    );
    expect(
      toSessionPoolUrl('postgresql://u:p@AWS-0-US-WEST-2.POOLER.SUPABASE.COM:6543/postgres'),
    ).toContain(':5432/postgres');
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

describe('safeHostPort', () => {
  it('extracts host:port without credentials', () => {
    expect(safeHostPort('postgresql://user:secret@aws-0.pooler.supabase.com:6543/postgres')).toBe(
      'aws-0.pooler.supabase.com:6543',
    );
  });

  it('never echoes an unparsable DSN', () => {
    expect(safeHostPort('not a url with secret')).toBe('unparsable-dsn');
  });
});
