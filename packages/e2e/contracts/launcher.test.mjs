import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  prepareStackWorkspace,
  stackCommands,
  stackEnvironment,
} from '../helpers/isolated-stack.mjs';

const safe = {
  E2E_ISOLATED: '1',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5404/declutrmail_e2e',
  REDIS_URL: 'redis://127.0.0.1:6404/12',
  E2E_WEB_URL: 'http://127.0.0.1:3104',
  E2E_API_URL: 'http://127.0.0.1:4104',
};

test('launcher cannot carry real credentials or Node/env preloads into either server', () => {
  const env = stackEnvironment({
    ...safe,
    RESEND_API_KEY: 'real-secret',
    PADDLE_API_KEY: 'real-secret',
    GOOGLE_CLIENT_SECRET: 'real-secret',
    NEXT_PUBLIC_POSTHOG_KEY: 'real-secret',
    NODE_OPTIONS: '--env-file=/real/.env',
    DOTENV_CONFIG_PATH: '/real/.env',
    HTTP_PROXY: 'http://external.example',
    SENTRY_AUTH_TOKEN: 'real-secret',
  });
  for (const command of stackCommands('/temporary', env)) {
    assert(!JSON.stringify(command).includes('real-secret'));
    assert(!JSON.stringify(command).includes('--env-file'));
    assert.equal(command.env.NODE_OPTIONS, undefined);
    assert.equal(command.env.DOTENV_CONFIG_PATH, undefined);
    assert.equal(command.env.HTTP_PROXY, undefined);
    assert.equal(command.env.PADDLE_API_KEY, undefined);
    assert.equal(command.env.NEXT_PUBLIC_POSTHOG_KEY, '');
  }
});

test('unsafe targets and mismatched cookie hosts fail before startup', () => {
  assert.throws(() => stackEnvironment({ ...safe, E2E_ISOLATED: undefined }));
  assert.throws(() => stackEnvironment({ ...safe, E2E_WEB_URL: 'http://localhost:3104' }));
  assert.throws(() => stackEnvironment({ ...safe, E2E_API_URL: 'http://127.0.0.1:3104' }));
  assert.throws(() => stackEnvironment({ ...safe, E2E_API_URL: 'http://127.0.0.1:4104/path' }));
});

test('app copies exclude all dotenv files and keep Next output away from the working app', () => {
  const source = mkdtempSync(path.join(tmpdir(), 'e2e-launcher-test-'));
  let copy;
  try {
    mkdirSync(path.join(source, 'node_modules'));
    writeFileSync(path.join(source, 'tsconfig.base.json'), '{}');
    writeFileSync(path.join(source, 'package.json'), '{}');
    writeFileSync(path.join(source, '.env.local'), 'ROOT_SECRET=secret');
    for (const app of ['api', 'web']) {
      const dir = path.join(source, 'apps', app);
      mkdirSync(path.join(dir, 'src'), { recursive: true });
      mkdirSync(path.join(dir, 'node_modules'));
      mkdirSync(path.join(dir, '.next'));
      writeFileSync(path.join(dir, '.next', 'existing'), 'untouched');
      for (const name of ['.env', '.env.local', '.env.development', '.env.development.local'])
        writeFileSync(path.join(dir, name), 'SECRET=secret');
      writeFileSync(path.join(dir, 'src', '.env'), 'NESTED_SECRET=secret');
      writeFileSync(path.join(dir, 'src', 'main.ts'), 'export const source = true;');
      writeFileSync(path.join(dir, 'package.json'), '{}');
      writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    }
    copy = prepareStackWorkspace(source);
    assert(!existsSync(path.join(copy, '.env.local')));
    for (const app of ['api', 'web']) {
      const dir = path.join(copy, 'apps', app);
      for (const name of [
        '.env',
        '.env.local',
        '.env.development',
        '.env.development.local',
        'src/.env',
        '.next',
      ])
        assert(!existsSync(path.join(dir, name)), name);
      assert.equal(
        readFileSync(path.join(dir, 'src/main.ts'), 'utf8'),
        'export const source = true;',
      );
      assert.equal(
        readFileSync(path.join(source, 'apps', app, '.next/existing'), 'utf8'),
        'untouched',
      );
    }
  } finally {
    if (copy) rmSync(copy, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});
