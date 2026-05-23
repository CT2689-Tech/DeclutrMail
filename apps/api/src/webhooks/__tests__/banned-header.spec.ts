import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guard test (D229 + CLAUDE.md §2.5).
 *
 * The `x-goog-authenticated-user-email` header is Cloud Run IAM
 * identity, NOT the Pub/Sub authenticated-push mechanism. Per D229
 * it must NEVER appear in EXECUTABLE production code. If it ever does,
 * this test fails — even before `webhook-security-auditor` reviews
 * the PR.
 *
 * We scan the entire `apps/api/src` tree for any literal of the
 * banned header (case-insensitive) in executable code, asserting zero
 * hits. Documentation comments are explicitly allowed because the
 * whole point of those comments is to explain WHY this header is
 * banned — silencing the warning in code while leaving the rule
 * unexplained would lose institutional memory.
 *
 * Skip rules:
 *   - `__tests__/` directories (this file names the literal)
 *   - Lines that look like JSDoc/JS comments (start with `//`, `*`,
 *     `/*`) — the banned phrase shows up only in commentary.
 *
 * If somebody ever tries to READ the banned header from a request
 * (e.g. `req.headers['x-goog-authenticated-user-email']`), the
 * scanner WILL flag it because the literal sits in real code, not a
 * comment.
 */

const BANNED = /x-goog-authenticated-user-email/i;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
const API_SRC = join(import.meta.dirname, '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip __tests__ directories — they're allowed to name the literal.
      if (entry === '__tests__') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('banned header guard', () => {
  it('no production source file references x-goog-authenticated-user-email (D229)', () => {
    const files = walk(API_SRC);
    const hits: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (!BANNED.test(line)) return;
        if (COMMENT_LINE.test(line)) return;
        hits.push({ file, line: idx + 1, text: line.trim() });
      });
    }
    expect(
      hits,
      `Banned header found — D229 forbids x-goog-authenticated-user-email anywhere in production code.\n${hits
        .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
