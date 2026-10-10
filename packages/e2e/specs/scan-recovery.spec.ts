import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { BILLING_SEED } from '../helpers/seed-billing';
import { E2E_ENV, REPO_ROOT } from '../helpers/env';
import { assertIsolatedEnvironment } from '../helpers/isolation';

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);
function probe(mode: 'fail' | 'resume' | 'reconnect' | 'expired') {
  assertIsolatedEnvironment(process.env);
  const output = execFileSync(
    'pnpm',
    ['exec', 'tsx', '--tsconfig', 'tsconfig.json', 'src/sync/testing/scan-recovery-probe.ts', mode],
    {
      cwd: path.join(REPO_ROOT, 'apps/api'),
      env: process.env,
      timeout: 45_000,
      encoding: 'utf8',
    },
  );
  return JSON.parse(output.trim().split('\n').at(-1)!);
}
test.beforeEach(async () => {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
    await sql`UPDATE users SET onboarded_at = NULL WHERE id = ${BILLING_SEED.userId}`;
  } finally {
    await sql.end();
  }
});
test.afterEach(async () => {
  const sql = dbConnect();
  try {
    await applyJourneySeed(sql);
  } finally {
    await sql.end();
  }
});

test('terminal scan survives refresh, automatically resumes saved messages and returns to work', async ({
  page,
}) => {
  expect(probe('fail')).toMatchObject({ readiness: 'failed', cursor: '1000', metadataGets: 10 });
  await page.goto(`${E2E_ENV.apiUrl}/api/auth/dev/login?email=${BILLING_SEED.email}`);
  await page.goto('/onboarding?returnTo=%2Fsenders');
  await expect(
    page.getByRole('heading', { name: 'Your scan will resume', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Your progress is saved/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry scheduled', exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your scan will resume', exact: true }),
  ).toBeVisible();
  expect(probe('resume')).toMatchObject({ readiness: 'ready', cursor: '1000', metadataGets: 1 });
  await expect(page.getByRole('button', { name: 'Skip setup for now', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await expect(page).toHaveURL(/\/senders$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toBeVisible();
  expect(probe('reconnect')).toMatchObject({
    readiness: 'ready',
    cursor: '2000',
    metadataGets: 1,
    fullLists: 0,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toBeVisible();
});

test('reconnect with an expired history cursor falls back to a fresh snapshot', async ({
  page,
}) => {
  probe('fail');
  probe('resume');
  expect(probe('expired')).toMatchObject({ readiness: 'ready', cursor: '3000' });
  await page.goto(`${E2E_ENV.apiUrl}/api/auth/dev/login?email=${BILLING_SEED.email}`);
  await page.goto('/onboarding');
  await expect(page.getByRole('button', { name: 'Skip setup for now', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await expect(page).toHaveURL(/\/senders$/);
});
