import { expect, test } from '@playwright/test';
import { expectScreenMounted } from '../helpers/screen-ready';
import type postgres from 'postgres';

import { applyJourneySeed } from '../helpers/seed-journeys';

import { ApiClient, requireLiveStack, type TriageQueueRow } from '../helpers/api';
import { dbConnect } from '../helpers/db';

/**
 * Explanations on demand (D24, founder decision 2026-09-25).
 *
 * Opening Triage asks for the sentence behind every queue row still on the
 * template, and the API queues the work. No worker runs in this suite, so
 * the sentence itself never lands; what this pins is the join the unit
 * suites stub on both sides — the page's ask reaching the API, and the API
 * accepting it onto the queue.
 */

const api = new ApiClient();
let sql: postgres.Sql;

test.beforeAll(async () => {
  const live = await requireLiveStack(api);
  expect(live.mailboxId).not.toBeNull();
  sql = dbConnect();
  await applyJourneySeed(sql);
});

test.afterAll(async () => {
  if (sql) await sql.end();
  await api.dispose();
});

test('opening Triage asks for the sentences its template reasons need', async ({ page }) => {
  // The page's own queue: the bootstrap read, sized by D30 — not
  // `/api/triage/queue`, whose default is the ceiling.
  const { queue: rows } = await api.get<{ queue: TriageQueueRow[] }>('/api/triage/bootstrap');
  const templateIds = rows
    .filter((row) => row.generatedBy === 'template' && !row.stale)
    .map((row) => row.senderId);
  expect(templateIds.length, 'the journey seed queues a template reason').toBeGreaterThan(0);

  const asked = page.waitForResponse(
    (res) => res.url().endsWith('/api/triage/explain') && res.request().method() === 'POST',
  );
  await page.goto('/triage');
  await expectScreenMounted(page);
  const response = await asked;

  expect(response.status()).toBe(202);
  const sent = (response.request().postDataJSON() as { senderIds: string[] }).senderIds;
  expect(sent).toEqual(expect.arrayContaining(templateIds));
  const body = (await response.json()) as { data: { queued: string[] } };
  expect(body.data.queued).toEqual(expect.arrayContaining(templateIds));
});
