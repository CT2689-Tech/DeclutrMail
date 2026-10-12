import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cliExitCode, nativeClient, rehearse } from './upstash-free-revocation-rehearsal.mjs';

// Preparation only: dispatch requires separately recorded founder spending approval.
// The free entrypoint never reads this confirmation or opts into this paid mode.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) {
    console.error('Usage: node scripts/upstash-capped-revocation-rehearsal.mjs REPORT_PATH');
    process.exitCode = 1;
  } else {
    const require = createRequire(new URL('../packages/workers/package.json', import.meta.url));
    const Redis = require('ioredis');
    const report = await rehearse({
      mode: 'capped-payg',
      paidConfirmation: process.env.UPSTASH_PAID_TEST_CONFIRMATION,
      clientFactory: (credential) => nativeClient(Redis, credential),
    });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    process.exitCode = cliExitCode(report);
  }
}
