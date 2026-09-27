import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GOOGLE_TIMEOUT_MS, googleOAuthClient } from './google-oauth-client.js';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every non-test TypeScript file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !/\.(spec|test)\.ts$/.test(file) && !file.includes('node_modules'));
}

describe('googleOAuthClient', () => {
  it('gives every call the library makes to Google a ceiling', () => {
    const client = googleOAuthClient({ clientId: 'client-id', clientSecret: 'client-secret' });

    expect(client.transporter.defaults.timeout).toBe(GOOGLE_TIMEOUT_MS);
  });

  // A token refresh with no ceiling held the OAuth callback (it awaits
  // `users.watch`) and sync jobs; one direct construction brings it back.
  it('is how the API builds every OAuth2Client', () => {
    const files = [
      ...sourceFiles(path.join(API_ROOT, 'src')),
      ...sourceFiles(path.join(API_ROOT, 'scripts')),
    ];
    const direct = files
      .filter((file) => readFileSync(file, 'utf8').includes('new OAuth2Client('))
      .map((file) => path.relative(API_ROOT, file));

    // The scan has to be able to see one: the factory's own.
    expect(files.length).toBeGreaterThan(100);
    expect(direct).toEqual(['src/gmail/google-oauth-client.ts']);
  });
});
