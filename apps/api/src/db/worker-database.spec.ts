import { expect, it } from 'vitest';
import { createWorkerDatabase } from './worker-database.js';

it('uses session pooling for persistent pipelined clients without changing the worker connection budget', async () => {
  const connection = createWorkerDatabase({
    DATABASE_URL:
      'postgres://synthetic:local@aws-0-us-west-2.pooler.supabase.com:6543/postgres?sslmode=require',
    WORKER_DB_POOL_MAX: '7',
    API_DB_POOL_MAX: '20',
  });
  try {
    expect(connection.db.$client.options.port).toEqual([5432]);
    expect(connection.db.$client.options.max).toBe(7);
    expect(connection.db.$client.options.prepare).toBe(false);
  } finally {
    await connection.close();
  }
});
