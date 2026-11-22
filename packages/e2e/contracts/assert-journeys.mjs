import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { expectedJourneys } from './journey-lanes.mjs';

// Pin every journey file, not just a nonempty aggregate report. Missing file = failure.
// An optional lane argument narrows the expectation to that CI lane's files.
const expected = expectedJourneys(process.argv[3]);
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const counts = new Map();
function visit(suite) {
  for (const spec of suite.specs ?? []) {
    const file = spec.file.split('/').pop();
    for (const test of spec.tests ?? []) {
      assert.equal(test.status, 'expected', `${file}: journey failed, skipped, or flaky`);
      assert(
        test.results?.some((r) => r.status === 'passed'),
        `${file}: no passing execution`,
      );
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  for (const child of suite.suites ?? []) visit(child);
}
visit(report);
for (const [file, minimum] of expected)
  assert(
    (counts.get(file) ?? 0) >= minimum,
    `${file}: expected at least ${minimum} executed journeys`,
  );
console.log(
  `Every required isolated journey executed successfully${process.argv[3] ? ` (${process.argv[3]})` : ''}.`,
);
