import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isErrorCode } from '@declutrmail/shared/contracts';

/**
 * The registry contract (ADR-0014).
 *
 * `AllExceptionsFilter.resolve` preserves a thrown body `code` ONLY when
 * it is a key of `ERROR_CODES`; anything else is rewritten to the
 * status-derived generic (BAD_REQUEST / NOT_FOUND / CONFLICT /
 * INTERNAL_ERROR). So an unregistered code is not a lint nit — it is a
 * silent contract break: the server means `PROTECTED_SENDER`, the client
 * receives `CONFLICT`, and every FE branch testing for the domain code
 * is dead code that can never run.
 *
 * That is precisely the bug ADR-0014 was written to fix, and it regrew
 * to 40 codes because nothing tested the JOIN — API specs assert `code`
 * on the THROWN exception, web tests mock the RESPONSE BODY, and the
 * filter deletes the code between them with both suites green. This test
 * is the missing middle: it reads the actual throw sites.
 */

const API_SRC = fileURLToPath(new URL('..', import.meta.url));

/** Codes that are deliberately not domain codes of ours. */
const NOT_OURS = new Set([
  // Node/undici runtime error codes, allowlisted separately by the
  // filter's `safeExceptionCode` — never a response `code`.
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.includes('.spec.') || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

describe('error-code registry covers every code the API throws', () => {
  const files = walk(API_SRC);

  it('reads a non-trivial number of source files (guards against a vacuous pass)', () => {
    // An empty file list would make every assertion below trivially true.
    // Prove the input was readable before asserting anything about it.
    expect(files.length).toBeGreaterThan(50);
  });

  it('has a registry entry for every `code:` literal at a throw site', () => {
    const unregistered = new Map<string, string[]>();

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/code: '([A-Z][A-Z_]{3,})'/g)) {
        const code = match[1]!;
        if (NOT_OURS.has(code) || isErrorCode(code)) continue;
        const where = file.slice(API_SRC.length);
        const seen = unregistered.get(code) ?? [];
        if (!seen.includes(where)) seen.push(where);
        unregistered.set(code, seen);
      }
    }

    expect(
      Object.fromEntries([...unregistered].map(([code, where]) => [code, where.join(', ')])),
      'These codes are thrown but absent from ERROR_CODES, so AllExceptionsFilter ' +
        'will flatten them to the status-derived generic and any FE branch testing ' +
        'for them is dead. Add them to packages/shared/src/contracts/error-codes.ts.',
    ).toEqual({});
  });
});
