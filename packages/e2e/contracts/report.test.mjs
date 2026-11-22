import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { journeyLanes } from './journey-lanes.mjs';

const files = Object.values(journeyLanes)
  .flat()
  .map(([file, n]) => [file.replace(/\.spec\.ts$/, ''), n]);
function report(only = files) {
  return {
    suites: [
      {
        specs: only.flatMap(([file, n]) =>
          Array.from({ length: n }, () => ({
            file: `specs/${file}.spec.ts`,
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          })),
        ),
      },
    ],
  };
}
function check(body, lane) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-report-'));
  try {
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify(body));
    return spawnSync(
      process.execPath,
      ['contracts/assert-journeys.mjs', path, ...(lane ? [lane] : [])],
      {
        encoding: 'utf8',
      },
    ).status;
  } finally {
    rmSync(dir, { recursive: true });
  }
}
test('complete journey report passes', () => assert.equal(check(report()), 0));
test('missing the existing-rule editor journey fails despite the other Autopilot journey passing', () => {
  const body = report();
  const index = body.suites[0].specs.findIndex((spec) =>
    spec.file.endsWith('/autopilot-pages.spec.ts'),
  );
  body.suites[0].specs.splice(index, 1);
  assert.notEqual(check(body), 0);
});
test('one missing required journey fails despite eleven passing tests', () => {
  const body = report();
  body.suites[0].specs.shift();
  assert.notEqual(check(body), 0);
});
test('skipped journey cannot make a green report', () => {
  const body = report();
  body.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.notEqual(check(body), 0);
});
test('flaky retry cannot hide a failed journey', () => {
  const body = report();
  body.suites[0].specs[0].tests[0].status = 'flaky';
  assert.notEqual(check(body), 0);
});

test('missing the manual Delete preview matrix cannot pass the journey gate', () => {
  const body = report();
  body.suites[0].specs = body.suites[0].specs.filter(
    (spec) => !spec.file.endsWith('/manual-delete-previews.spec.ts'),
  );
  assert.notEqual(check(body), 0);
});

test('missing either genuinely empty Triage presentation cannot pass the journey gate', () => {
  const body = report();
  const index = body.suites[0].specs.findIndex((spec) =>
    spec.file.endsWith('/manual-delete-previews.spec.ts'),
  );
  body.suites[0].specs.splice(index, 1);
  assert.notEqual(check(body), 0);
});

test('each CI lane passes on exactly its own files and fails on a missing one', () => {
  for (const [lane, entries] of Object.entries(journeyLanes)) {
    const own = files.filter(([file]) => entries.some(([name]) => name === `${file}.spec.ts`));
    assert.equal(check(report(own), lane), 0, lane);
    for (const index of own.keys())
      assert.notEqual(check(report(own.filter((_, i) => i !== index)), lane), 0, own[index][0]);
  }
  // A lane is not the whole suite: one lane's report fails the other lane.
  const [first, second] = Object.keys(journeyLanes);
  const firstOnly = files.filter(([file]) =>
    journeyLanes[first].some(([name]) => name === `${file}.spec.ts`),
  );
  assert.notEqual(check(report(firstOnly), second), 0);
  assert.notEqual(check(report(firstOnly)), 0, 'no lane means every journey');
  assert.notEqual(check(report(), 'journeys'), 0, 'an unknown lane fails');
});

test('the lane scripts run exactly the pinned files, together the whole local suite', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts;
  const filesOf = (script) => {
    const match = /^playwright test ((?:[a-z-]+ )+)--project=default$/.exec(script ?? '');
    assert.ok(match, script);
    return match[1].trim().split(' ').sort();
  };
  const all = [];
  for (const [lane, entries] of Object.entries(journeyLanes)) {
    const pinned = entries.map(([file]) => file.replace(/\.spec\.ts$/, '')).sort();
    assert.deepEqual(filesOf(scripts[`e2e:${lane}`]), pinned, lane);
    all.push(...pinned);
  }
  assert.equal(new Set(all).size, all.length, 'a spec is in two lanes');
  assert.deepEqual(filesOf(scripts['e2e:journeys']), all.sort());
});
