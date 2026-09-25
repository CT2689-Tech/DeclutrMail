import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGmailQuotaMetric } from './gmail-client.service.js';
import { resolveGmailQuotaConfig } from './gmail-quota-config.js';

describe('parseGmailQuotaMetric (D5)', () => {
  it.each([undefined, ''])('treats %j as the newer total_query_cost metric', (raw) => {
    expect(parseGmailQuotaMetric(raw)).toBe('gmail.googleapis.com/total_query_cost');
  });

  it.each(['gmail.googleapis.com/default', 'gmail.googleapis.com/total_query_cost'])(
    'accepts %s',
    (raw) => {
      expect(parseGmailQuotaMetric(raw)).toBe(raw);
    },
  );

  // A bare `default` reads like "use the default setting" — exactly the
  // misreading the full metric name exists to prevent — so it must not boot.
  it.each(['default', 'total_query_cost', 'gmail.googleapis.com/Default', ' '])(
    'refuses %j so a typo fails the boot',
    (raw) => {
      expect(() => parseGmailQuotaMetric(raw)).toThrow(/GMAIL_QUOTA_METRIC must be one of/);
    },
  );
});

describe('resolveGmailQuotaConfig (D5)', () => {
  it('unset: a newer project — 4,800 units, 20 per read', () => {
    expect(resolveGmailQuotaConfig({})).toEqual({
      metric: 'gmail.googleapis.com/total_query_cost',
      unitsPerMin: 4_800,
      burstCapacity: 400,
      messagesGetUnits: 20,
    });
  });

  it('production settings: 12,000 units on the grandfathered metric, 5 per read', () => {
    expect(
      resolveGmailQuotaConfig({
        GMAIL_QUOTA_UNITS_PER_MIN: '12000',
        GMAIL_QUOTA_METRIC: 'gmail.googleapis.com/default',
      }),
    ).toEqual({
      metric: 'gmail.googleapis.com/default',
      unitsPerMin: 12_000,
      burstCapacity: 1_000,
      messagesGetUnits: 5,
    });
  });

  it.each(['1199', '12001', '6000.5', 'abc'])('refuses GMAIL_QUOTA_UNITS_PER_MIN=%s', (raw) => {
    expect(() => resolveGmailQuotaConfig({ GMAIL_QUOTA_UNITS_PER_MIN: raw })).toThrow(
      /must be an integer from 1200 to 12000/,
    );
  });

  it('refuses a bad metric even with a valid budget', () => {
    expect(() =>
      resolveGmailQuotaConfig({
        GMAIL_QUOTA_UNITS_PER_MIN: '12000',
        GMAIL_QUOTA_METRIC: 'default',
      }),
    ).toThrow(/GMAIL_QUOTA_METRIC must be one of/);
  });
});

/**
 * The production worker's budget and its per-method prices must come from
 * the same Google quota metric. `GMAIL_QUOTA_UNITS_PER_MIN=12000` is 80% of
 * the grandfathered `gmail.googleapis.com/default` limit (15,000), where
 * `messages.get` costs 5 units. Dropping `GMAIL_QUOTA_METRIC` from the
 * manifest would price reads at 20 units against that budget and quietly cut
 * first-sync speed to a quarter — the regression shipped 2026-09-24 (UTC).
 * It has to live in the manifest because `--set-env-vars` full-replaces the
 * live service env.
 */
describe('production worker quota pricing survives deployment', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../../../../.github/workflows/deploy-cloud-run.yml'),
    'utf8',
  );

  // The worker's own deploy step, bounded at the NEXT deploy so a service
  // without its own env block cannot adopt a neighbour's. Exact service
  // name: a `declutrmail-worker-canary` deploy must not match.
  const deploys = [...workflow.matchAll(/gcloud run deploy (\S+)/g)];
  const workerAt = deploys.findIndex((deploy) => deploy[1] === 'declutrmail-worker');
  const section =
    workerAt === -1
      ? ''
      : workflow.slice(deploys[workerAt]!.index, deploys[workerAt + 1]?.index ?? workflow.length);
  const payload = /--set-env-vars="((?:[^"\\]|\\.)*)"/.exec(section)?.[1] ?? '';
  // `^|^` sets `|` as the delimiter. gcloud keeps the LAST value for a
  // repeated key, so a duplicate is a failure, not something to skip past.
  const assignments = payload.replace(/^\^\|\^/, '').split('|');
  const envValues = (name: string): string[] =>
    assignments
      .filter((entry) => entry.startsWith(`${name}=`))
      .map((entry) => entry.slice(name.length + 1));

  it('finds the worker env block — an empty parse must not pass', () => {
    expect(workerAt).not.toBe(-1);
    expect(payload).toContain('GMAIL_QUOTA_UNITS_PER_MIN=');
  });

  it('sets each quota key exactly once', () => {
    expect(envValues('GMAIL_QUOTA_UNITS_PER_MIN')).toHaveLength(1);
    expect(envValues('GMAIL_QUOTA_METRIC')).toHaveLength(1);
  });

  it('reads 2,400 emails a minute per mailbox — the grandfathered metric’s pace', () => {
    const config = resolveGmailQuotaConfig({
      GMAIL_QUOTA_UNITS_PER_MIN: envValues('GMAIL_QUOTA_UNITS_PER_MIN')[0],
      GMAIL_QUOTA_METRIC: envValues('GMAIL_QUOTA_METRIC')[0],
    });
    expect(config.metric).toBe('gmail.googleapis.com/default');
    expect(config.unitsPerMin / config.messagesGetUnits).toBe(2_400);
  });
});
