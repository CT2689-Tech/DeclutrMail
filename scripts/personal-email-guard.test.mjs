import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findPersonalAddresses, scanRepo } from './personal-email-guard.mjs';

test('no tracked file carries a personal email address', () => {
  const { scanned, findings } = scanRepo();
  assert.ok(scanned >= 500, `scanned only ${scanned} files`);
  assert.deepEqual(
    findings,
    [],
    'Redact these; cite a workspace or mailbox id prefix instead (D7):\n' +
      findings.map(({ file, address }) => `${file}: ${address}`).join('\n'),
  );
});

test('a real-looking address is caught; placeholders and business senders are not', () => {
  assert.deepEqual(findPersonalAddresses('signups (`jane.doe42@gmail.com`, x@yahoo.co.in)'), [
    'jane.doe42@gmail.com',
    'x@yahoo.co.in',
  ]);
  assert.deepEqual(
    findPersonalAddresses(
      'you@gmail.com Owner@Gmail.com ${ALERT_EMAIL:-you@gmail.com} news@substack.com donotreply@dmv.ca.gov',
    ),
    [],
  );
});

test('the scan refuses to report clean when it cannot see the files', () => {
  const empty = mkdtempSync(join(tmpdir(), 'email-guard-'));
  execFileSync('git', ['init', '-q', empty]);
  assert.throws(() => scanRepo(empty), /refusing to report clean/);
});
