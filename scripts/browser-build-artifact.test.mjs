import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserBuildArtifact } from './browser-build-artifact.mjs';

test('transferred browser output requires this commit, workflow run and compile-time configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-build-'));
  const env = {
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '123',
    BROWSER_BUILD_PROFILE: 'classic',
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4104',
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_e2e_dummy',
    E2E_ISOLATED: '1',
    E2E_POSTHOG: '1',
    PRICING_V2: 'false',
    METER_V2: 'false',
    BILLING_PASS_ENABLED: 'false',
    GOOGLE_CLIENT_SECRET: 'must-never-be-recorded',
  };
  const files = {
    BUILD_ID: 'compiled-build',
    'build-manifest.json': '{"pages":{}}',
    'routes-manifest.json': '{"version":3}',
    'server/app-paths-manifest.json': '{"/page":"app/page.js"}',
  };
  mkdirSync(join(directory, 'server'));
  const run = (mode, settings = env) => browserBuildArtifact(mode, directory, settings);
  try {
    for (const [file, content] of Object.entries(files))
      writeFileSync(join(directory, file), content);
    assert.throws(() => run('verify'), /ENOENT/);
    run('stamp');
    run('verify');
    assert.ok(
      !readFileSync(join(directory, 'ci-browser-build.json'), 'utf8').includes(
        env.GOOGLE_CLIENT_SECRET,
      ),
    );
    for (const [key, value] of Object.entries(env)) {
      if (key === 'GOOGLE_CLIENT_SECRET') continue;
      assert.throws(() => run('verify', { ...env, [key]: `${value}changed` }), key);
      assert.throws(() => run('verify', { ...env, [key]: '' }), key);
    }
    for (const [file, content] of Object.entries(files)) {
      rmSync(join(directory, file));
      assert.throws(() => run('verify'), file);
      writeFileSync(join(directory, file), file === 'BUILD_ID' ? '' : '{}');
      assert.throws(() => run('verify'), file);
      writeFileSync(join(directory, file), content);
    }
    writeFileSync(join(directory, 'BUILD_ID'), 'different-build');
    assert.throws(() => run('verify'), /provenance mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
