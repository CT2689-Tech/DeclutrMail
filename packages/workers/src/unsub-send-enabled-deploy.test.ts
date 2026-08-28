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
 * Two things prevent that, and neither is in TypeScript:
 *
 *   1. `deploy-cloud-run.yml` sets `UNSUB_SEND_ENABLED=true` on both services.
 *      It has to live THERE and not merely be set live, because
 *      `--set-env-vars` full-replaces: a var set only on the live service is
 *      wiped by the next deploy, and production goes quiet again.
 *   2. `worker.ts` refuses to boot in production without it, so a drop is a
 *      failed deploy rather than a silent outage.
 *
 * (2) is glue this suite cannot reach without booting the composition root.
 * (1) is a string in YAML that no type checks and no test noticed until this
 * one — the exact shape of thing that rots quietly. So it gets asserted here.
 */
const WORKFLOW = readFileSync(
  join(import.meta.dirname, '../../../.github/workflows/deploy-cloud-run.yml'),
  'utf8',
);

describe('UNSUB_SEND_ENABLED survives deployment', () => {
  it('is set to true in the deploy workflow, for both services', () => {
    // Both, deliberately: the worker performs the send, and the API needs the
    // same answer to refuse at the enqueue boundary rather than writing a row
    // the recovery machinery would later offer to retry.
    const occurrences = WORKFLOW.match(/UNSUB_SEND_ENABLED=true/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });

  it('is never set to anything the predicate would reject', () => {
    // `UNSUB_SEND_ENABLED=TRUE` or `=1` in the workflow would deploy cleanly,
    // pass a careless grep, and silently disable production sending.
    const assignments = WORKFLOW.match(/UNSUB_SEND_ENABLED=([^,|"\s]*)/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    for (const assignment of assignments) {
      const value = assignment.split('=')[1] ?? '';
      expect(unsubSendsEnabled({ UNSUB_SEND_ENABLED: value })).toBe(true);
    }
  });
});
