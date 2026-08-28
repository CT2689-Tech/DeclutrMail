import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isErrorCode } from '@declutrmail/shared/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Every domain code thrown from an HTTP exception must be REGISTERED.
 *
 * `AllExceptionsFilter` projects a thrown body's `code` through
 * `isErrorCode()` and silently drops anything unregistered, flattening the
 * envelope to the generic status code. The client then branches on a code
 * that never arrives, and the designed state it was written for never
 * renders.
 *
 * The registry's own comment names this bug and says it "regrew because
 * nothing tested the JOIN: API specs assert `code` on the THROWN exception,
 * web tests mock the RESPONSE BODY, and the filter deletes the code in
 * between with both suites green."
 *
 * It regrew again. `UNSUB_SEND_DISABLED` was thrown by the actions service,
 * asserted in an API spec, branched on in three web handlers, and covered by
 * tests on both sides — and the filter deleted it, so the toast a user saw
 * was the generic failure copy and the designed refusal fired Sentry. Only
 * driving it in a browser found that.
 *
 * The registry contract test checks the registry's own shape. This checks the
 * join, which is where the bug lives.
 *
 * SCOPE, stated because the first version of this file was blind to the very
 * case it was written for. It scans STRING LITERALS — `code: 'SOME_CODE'` —
 * which is how nearly every throw here is written. It cannot see a code
 * passed as an identifier, and `UNSUB_SEND_DISABLED` is passed that way, so
 * this file would have reported green on the exact bug above.
 *
 * Identifier-form codes are guarded by TYPE instead: the constant is declared
 * `: ErrorCode`, which is the registry's key union, so removing its entry
 * fails the build. That is the stronger mechanism and the one to prefer for
 * new codes. This scan exists for the literal form, which no type can reach.
 */
const API_SRC = join(import.meta.dirname, '..');

const EXCEPTION_WITH_CODE =
  /new (?:Conflict|BadRequest|NotFound|Forbidden|Unauthorized|ServiceUnavailable|Gone|UnprocessableEntity|PaymentRequired)Exception\(\{[^}]*?code:\s*'([A-Z][A-Z0-9_]*)'/gs;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(API_SRC);

const THROWN = FILES.flatMap((file) => {
  const body = readFileSync(file, 'utf8');
  return [...body.matchAll(EXCEPTION_WITH_CODE)].map((m) => ({
    code: m[1]!,
    file: file.slice(API_SRC.length + 1),
  }));
});

describe('thrown domain codes (string-literal form) survive the exception filter', () => {
  it('finds thrown codes at all', () => {
    // The blind case, asserted first. Every check below filters this list, so
    // a regex that stops matching (a formatter change, a new exception class)
    // would leave it empty and report green having verified nothing.
    expect(THROWN.length).toBeGreaterThan(5);
  });

  it('registers every one of them', () => {
    const unregistered = THROWN.filter((t) => !isErrorCode(t.code)).map(
      (t) => `${t.code} (${t.file})`,
    );
    // An unregistered code is not a lint nit. The filter replaces it with the
    // status code, so the client's branch for it is unreachable — dead code
    // that typechecks, tests green, and does nothing in production.
    expect([...new Set(unregistered)]).toEqual([]);
  });
});
