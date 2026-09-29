import { describe, expect, it } from 'vitest';
import { apiPoolOptions } from './pool-config.js';

describe('API connection pool budget', () => {
  it('keeps the existing ten-client default and accepts a smaller pool', () => {
    expect(apiPoolOptions({})).toEqual({ max: 10 });
    expect(apiPoolOptions({ API_DB_POOL_MAX: '4' })).toEqual({ max: 4 });
  });

  it.each(['0', '-1', '21', '1.5', 'Infinity', 'secret-value'])(
    'rejects invalid caps without echoing values: %s',
    (value) => {
      expect(() => apiPoolOptions({ API_DB_POOL_MAX: value })).toThrow(
        'API_DB_POOL_MAX must be an integer between 1 and 20',
      );
    },
  );
});
