import { expect, it } from 'vitest';
import { buildRehearsalClient } from '../../../scripts/helpers/sandbox-rehearsal-client.js';

it('bundles the existing checkout launcher without credentials or provider I/O', async () => {
  const js = await buildRehearsalClient();
  expect(js).toContain('initializePaddle');
  expect(js).toContain('/checkout');
  expect(js).not.toContain('sandbox-api.paddle.com');
  expect(js).not.toContain('pdl_sdbx_apikey_');
}, 30000);
