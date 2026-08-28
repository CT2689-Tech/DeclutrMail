import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { unsubSendsEnabled } from './unsub-execution.worker.js';

/**
 * The deploy config is part of this kill switch, not context around it.
 *
 * `unsubSendsEnabled` fails closed in EVERY environment: silence means do not
 * send. That is correct on a laptop and fatal in production, where the same
 * silence stops every real unsubscribe while recording each one as a handled
 * `failed` job — the feature looking exactly like it works.
 *
 * Two things prevent that, and neither is TypeScript:
 *
 *   1. `deploy-cloud-run.yml` sets `UNSUB_SEND_ENABLED=true` on BOTH services.
 *      It must live there rather than be set live, because `--set-env-vars`
 *      full-replaces: a var set only on the live service is wiped by the next
 *      deploy and production goes quiet again.
 *   2. `worker.ts` refuses to boot in production without it, so a drop on the
 *      worker is a failed deploy rather than a silent outage.
 *
 * (2) covers only the worker. Nothing catches a drop on the API, which needs
 * the same answer to refuse at the enqueue boundary — so on that side a
 * missing var is silent in exactly the way this whole mechanism exists to
 * prevent. Hence the per-service assertions below.
 */
const WORKFLOW = readFileSync(
  join(import.meta.dirname, '../../../.github/workflows/deploy-cloud-run.yml'),
  'utf8',
);

/** Every service's own `--set-env-vars` payload, keyed by service name. */
function envBlocksByService(workflow: string): Map<string, string> {
  const blocks = new Map<string, string>();
  // Each deploy is `gcloud run deploy <service>` followed by its own
  // `--set-env-vars="…"`. Anchoring on the deploy line rather than counting
  // occurrences file-wide is the point: two vars in ONE block would satisfy a
  // file-wide count while leaving the other service unprotected.
  const deploys = [...workflow.matchAll(/gcloud run deploy (\S+)/g)];
  for (const deploy of deploys) {
    const after = workflow.slice(deploy.index);
    const envVars = /--set-env-vars="((?:[^"\\]|\\.)*)"/.exec(after);
    if (envVars?.[1] !== undefined) blocks.set(deploy[1]!, envVars[1]);
  }
  return blocks;
}

const BLOCKS = envBlocksByService(WORKFLOW);
const SEND_SERVICES = ['declutrmail-api', 'declutrmail-worker'] as const;

describe('UNSUB_SEND_ENABLED survives deployment', () => {
  it('finds both deploys — the parse itself must not come back empty', () => {
    // The blind case, asserted FIRST. A renamed service or a reformatted
    // deploy step would make every loop below iterate over nothing and report
    // green having verified nothing at all.
    for (const service of SEND_SERVICES) {
      expect(BLOCKS.has(service)).toBe(true);
    }
  });

  it.each(SEND_SERVICES)('sets UNSUB_SEND_ENABLED on %s', (service) => {
    const block = BLOCKS.get(service);
    expect(block).toBeDefined();
    expect(block).toContain('UNSUB_SEND_ENABLED=');
  });

  it.each(SEND_SERVICES)('sets a value the predicate accepts on %s', (service) => {
    // `=TRUE` or `=1` would deploy cleanly, survive a careless grep, and
    // silently disable sending. The predicate is the only judge of the value.
    const block = BLOCKS.get(service) ?? '';
    const assignment = /UNSUB_SEND_ENABLED=([^,|"\s]*)/.exec(block);
    expect(assignment).not.toBeNull();
    expect(unsubSendsEnabled({ UNSUB_SEND_ENABLED: assignment?.[1] ?? '' })).toBe(true);
  });
});
