import { expect, test, type Route } from '@playwright/test';
import type postgres from 'postgres';
import type { QuietHoursConfig, QuietHoursState } from '@declutrmail/shared/contracts';
import { ApiClient, requireLiveStack } from '../helpers/api';
import { dbConnect } from '../helpers/db';
import { applyJourneySeed } from '../helpers/seed-journeys';
import { BILLING_SEED } from '../helpers/seed-billing';

/** Synthetic real API/UI configuration flow; no Gmail credentials or worker. */
const api = new ApiClient();
const MARKER = '__e2e_quiet_journey';
let sql: postgres.Sql;
let mailboxId: string;
let original: Record<string, unknown> = {};
let prepared = false;
let originalAttribution: { source: string | null; detail: string | null } | undefined;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  expect(live.mailboxId).not.toBeNull();
  mailboxId = live.mailboxId!;
  sql = dbConnect();
  await applyJourneySeed(sql);
  const userRows = await sql<{ source: string | null; detail: string | null }[]>`
    SELECT signup_attribution_heard_from AS source,
           signup_attribution_heard_detail AS detail
    FROM users WHERE id = ${BILLING_SEED.userId}
  `;
  originalAttribution = userRows[0];
  const rows = await sql<{ quiet_state: Record<string, unknown> }[]>`
    SELECT quiet_state FROM mailbox_accounts WHERE id = ${mailboxId}
  `;
  original = rows[0]!.quiet_state;
  const baseline = JSON.stringify({
    [MARKER]: 'synthetic co-tenancy evidence',
    quiet_hours: {
      enabled: false,
      start_local: '20:00',
      end_local: '21:00',
      timezone: 'UTC',
      updated_at: new Date().toISOString(),
    },
  });
  await sql`UPDATE mailbox_accounts SET quiet_state = quiet_state || ${baseline}::text::jsonb WHERE id = ${mailboxId}`;
  prepared = true;
  // Raw postgres-js serializes parameters inferred as jsonb. Text first
  // keeps already-stringified fixture JSON from becoming a JSON string/array.
  const baselineRead = await api.get<QuietHoursState>(`/api/mailboxes/${mailboxId}/quiet-hours`);
  expect(baselineRead.config).toEqual({
    enabled: false,
    startLocal: '20:00',
    endLocal: '21:00',
    timezone: 'UTC',
  });
});

test.afterAll(async () => {
  if (sql && prepared) {
    // Restore only the two keys this fixture owns, preserving all other tenants.
    const restore: Record<string, unknown> = {};
    for (const key of ['quiet_hours', MARKER]) {
      if (Object.hasOwn(original, key)) restore[key] = original[key];
    }
    await sql`
      UPDATE mailbox_accounts
      SET quiet_state = (quiet_state - 'quiet_hours' - ${MARKER}) || ${JSON.stringify(restore)}::text::jsonb
      WHERE id = ${mailboxId}
    `;
  }
  if (sql && originalAttribution) {
    await sql`
      UPDATE users SET signup_attribution_heard_from = ${originalAttribution.source},
        signup_attribution_heard_detail = ${originalAttribution.detail}
      WHERE id = ${BILLING_SEED.userId}
    `;
  }
  if (sql) await sql.end();
  await api.dispose();
});

test('Quiet hours save, rejected save, retry and disable survive real API reads and reload', async ({
  page,
}) => {
  const path = `/api/mailboxes/${mailboxId}/quiet-hours`;
  const pattern = `**${path}`;
  const config: QuietHoursConfig = {
    enabled: true,
    startLocal: '22:00',
    endLocal: '07:00',
    timezone: 'America/Los_Angeles',
  };
  await page.goto('/quiet');
  await expect(page.getByRole('heading', { level: 1, name: 'Quiet hours' })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Quiet hours', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const consent = page.getByRole('button', { name: 'Essential only', exact: true });
  // Fresh browser storage has no consent; choose through the visible UI.
  await expect(consent).toBeVisible();
  await consent.click();
  // The fixture may still have the optional self-report prompt. Its fixed
  // card can cover Save; dismiss through Skip, never force-click underneath.
  const me = await api.get<{ signupAttribution?: { promptNeeded?: boolean } }>('/api/auth/me');
  if (me.signupAttribution?.promptNeeded) {
    const prompt = page.getByTestId('heard-from-prompt');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(prompt).toBeHidden();
  }
  await toggle.click();
  await page.getByLabel('Quiet window start').fill(config.startLocal);
  await page.getByLabel('Quiet window end').fill(config.endLocal);
  const timezone = page.getByRole('combobox', { name: 'Quiet window timezone' });
  await timezone.focus();
  await timezone.selectOption(config.timezone);
  await expect(page.getByText('Ends at 07:00 the next day.')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save quiet hours', exact: true });
  const firstWrite = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === 'PUT',
  );
  await expect(save).toBeEnabled();
  await save.click();
  expect((await firstWrite).status()).toBe(200);
  expect((await api.get<QuietHoursState>(path)).config).toEqual(config);
  const firstStored = await sql<{ quiet_state: Record<string, unknown> }[]>`
    SELECT quiet_state FROM mailbox_accounts WHERE id = ${mailboxId}
  `;
  expect(firstStored[0]!.quiet_state[MARKER]).toBe('synthetic co-tenancy evidence');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(timezone).toHaveValue(config.timezone);
  await expect(page.getByLabel('Quiet window start')).toHaveValue(config.startLocal);
  await expect(page.getByLabel('Quiet window end')).toHaveValue(config.endLocal);

  // A controlled transport failure must not overwrite the stored schedule.
  const rejectWrite = async (route: Route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic unavailable write' },
      }),
    });
  };
  await page.route(pattern, rejectWrite);
  // Exercise the native time control with a real hour increment. Direct
  // temporal fill can leave the DOM value ahead of the controlled form draft.
  const end = page.getByLabel('Quiet window end');
  await end.focus();
  await end.press('ArrowUp');
  await expect(end).toHaveValue('08:00');
  await expect(page.getByText('Ends at 08:00 the next day.')).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText("Couldn't save quiet hours. Try again.", { exact: true }),
  ).toBeVisible();
  expect((await api.get<QuietHoursState>(path)).config).toEqual(config);
  const afterFailure = await sql<{ quiet_state: Record<string, unknown> }[]>`
    SELECT quiet_state FROM mailbox_accounts WHERE id = ${mailboxId}
  `;
  expect(afterFailure[0]!.quiet_state).toEqual(firstStored[0]!.quiet_state);
  await page.unroute(pattern, rejectWrite);
  await page.reload();
  await expect(page.getByLabel('Quiet window end')).toHaveValue('07:00');
  await end.focus();
  await end.press('ArrowUp');
  await expect(end).toHaveValue('08:00');
  await expect(page.getByText('Ends at 08:00 the next day.')).toBeVisible();
  await expect(save).toBeEnabled();
  const retry = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === 'PUT',
  );
  await save.click();
  expect((await retry).status()).toBe(200);
  expect((await api.get<QuietHoursState>(path)).config).toEqual({ ...config, endLocal: '08:00' });

  await toggle.click();
  const disable = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === 'PUT',
  );
  await save.click();
  expect((await disable).status()).toBe(200);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect((await api.get<QuietHoursState>(path)).config).toEqual({
    ...config,
    enabled: false,
    endLocal: '08:00',
  });
});
