import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGmailQuotaMetric } from './gmail-client.service.js';

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

/**
 * The production worker's budget and its per-method prices must come from
 * the same Google quota metric. `GMAIL_QUOTA_UNITS_PER_MIN=12000` is 80% of
 * the grandfathered `gmail.googleapis.com/default` limit (15,000), where
 * `messages.get` costs 5 units. Dropping `GMAIL_QUOTA_METRIC` from the
 * manifest would price reads at 20 units against that budget and quietly cut
 * first-sync speed to a quarter — the 2026-09-24 regression. It has to live in
 * the manifest because `--set-env-vars` full-replaces the live service env.
 */
describe('production worker quota pricing survives deployment', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../../../../.github/workflows/deploy-cloud-run.yml'),
    'utf8',
  );
  const deploy = /gcloud run deploy declutrmail-worker\b/.exec(workflow);
  const nextDeploy = deploy
    ? /gcloud run deploy \S+/.exec(workflow.slice(deploy.index + deploy[0].length))
    : null;
  const section = deploy
    ? workflow.slice(
        deploy.index,
        nextDeploy ? deploy.index + deploy[0].length + nextDeploy.index : undefined,
      )
    : '';
  const payload = /--set-env-vars="((?:[^"\\]|\\.)*)"/.exec(section)?.[1] ?? '';
  const envValue = (name: string): string | undefined =>
    new RegExp(`(?:^|[|^])${name}=([^|"]*)`).exec(payload)?.[1];

  it('finds the worker env block — an empty parse must not pass', () => {
    expect(deploy).not.toBeNull();
    expect(payload).toContain('GMAIL_QUOTA_UNITS_PER_MIN=');
  });

  it('prices reads on the grandfathered metric its 12,000-unit budget belongs to', () => {
    expect(envValue('GMAIL_QUOTA_UNITS_PER_MIN')).toBe('12000');
    expect(parseGmailQuotaMetric(envValue('GMAIL_QUOTA_METRIC'))).toBe(
      'gmail.googleapis.com/default',
    );
  });
});
