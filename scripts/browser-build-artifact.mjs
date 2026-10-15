import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Public, compile-time inputs only. No API credentials or mailbox fixtures.
const inputs = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'E2E_ISOLATED',
  'E2E_POSTHOG',
  'PRICING_V2',
  'METER_V2',
  'BILLING_PASS_ENABLED',
];

export function browserBuildArtifact(mode, directory, env) {
  assert.ok(['stamp', 'verify'].includes(mode), 'expected stamp or verify');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'missing commit SHA');
  assert.match(env.GITHUB_RUN_ID ?? '', /^\d+$/, 'missing workflow run ID');
  assert.ok(['classic', 'launch'].includes(env.BROWSER_BUILD_PROFILE), 'unknown build profile');
  for (const key of inputs) assert.ok(env[key], `missing build input ${key}`);

  const buildId = readFileSync(join(directory, 'BUILD_ID'), 'utf8').trim();
  assert.ok(buildId, 'empty Next build ID');
  for (const name of [
    'build-manifest.json',
    'routes-manifest.json',
    'server/app-paths-manifest.json',
  ]) {
    assert.ok(
      Object.keys(JSON.parse(readFileSync(join(directory, name), 'utf8'))).length,
      `empty ${name}`,
    );
  }
  const expected = {
    sha: env.GITHUB_SHA,
    run: env.GITHUB_RUN_ID,
    profile: env.BROWSER_BUILD_PROFILE,
    buildId,
    inputs: Object.fromEntries(inputs.map((key) => [key, env[key]])),
  };
  const file = join(directory, 'ci-browser-build.json');
  if (mode === 'stamp') writeFileSync(file, `${JSON.stringify(expected, null, 2)}\n`);
  else
    assert.deepEqual(
      JSON.parse(readFileSync(file, 'utf8')),
      expected,
      'browser build provenance mismatch',
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    browserBuildArtifact(process.argv[2], 'apps/web/.next', process.env);
    console.log(`Browser build ${process.argv[2]} passed for this commit, run and configuration.`);
  } catch (error) {
    console.error(`Browser build ${process.argv[2]} failed: ${error.message}`);
    process.exitCode = 1;
  }
}
