// scripts/personal-email-guard.mjs — fails when a tracked file carries a
// personal (consumer-mailbox) email address that is not a known placeholder.
//
// Why (D7): this repo is public. On 2026-09-03 (#722) two real signups'
// Gmail addresses were written into MISTAKES.md and a code comment while
// documenting their incident, and they stayed public for three weeks before
// anyone noticed (2026-09-26). Incident write-ups quote production data by
// habit, so the check has to be mechanical: a closed set of consumer mail
// domains, and a closed set of placeholder local parts that tests, stories
// and docs already use. A new placeholder goes in PLACEHOLDER_LOCAL_PARTS; a
// real person's address never does — cite a workspace or mailbox id prefix.
//
// Run: node scripts/personal-email-guard.mjs   (CI: the Lint job's test)

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The first character is alphanumeric so `${ALERT_EMAIL:-you@gmail.com}` reads as `you`.
const CONSUMER_ADDRESS =
  /[A-Za-z0-9][A-Za-z0-9._%+-]*@(?:gmail\.com|googlemail\.com|yahoo\.[a-z.]+|hotmail\.[a-z.]+|outlook\.[a-z.]+|live\.com|msn\.com|icloud\.com|me\.com|aol\.com|proton\.me|protonmail\.com)\b/gi;

/** Local parts already used as obvious stand-ins (plus the founder's own). */
export const PLACEHOLDER_LOCAL_PARTS = new Set([
  'active',
  'active+work',
  'chintan',
  'chintan.a.thakkar',
  'chintan.a.thakkar.archive',
  'chintan.a.thakkar.crypt',
  'disconnected',
  'first',
  'foo',
  'foo+notion',
  'friend',
  'inbox',
  'mailer-daemon',
  'oneshot',
  'owner',
  'person',
  'preferred',
  'story',
  'you',
]);

const TEXT_FILE = /\.(md|mdx|ts|tsx|mjs|cjs|js|jsx|json|ya?ml|sql|sh|tsv|csv|txt|html)$/i;

/** Every consumer-domain address in `text` that is not a placeholder. */
export function findPersonalAddresses(text) {
  return [...text.matchAll(CONSUMER_ADDRESS)]
    .map((match) => match[0])
    .filter((address) => !PLACEHOLDER_LOCAL_PARTS.has(address.split('@')[0].toLowerCase()));
}

/**
 * Scans every tracked text file. Throws rather than reporting clean when it
 * could not see the repository: an empty file list is not "no addresses".
 */
export function scanRepo(root = REPO_ROOT) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => TEXT_FILE.test(file) && file !== 'pnpm-lock.yaml');
  if (files.length < 500) {
    throw new Error(`saw only ${files.length} tracked text files — refusing to report clean`);
  }
  const findings = [];
  for (const file of files) {
    for (const address of findPersonalAddresses(readFileSync(join(root, file), 'utf8'))) {
      findings.push({ file, address });
    }
  }
  return { scanned: files.length, findings };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { scanned, findings } = scanRepo();
  for (const { file, address } of findings) console.error(`${file}: ${address}`);
  console.log(`${scanned} tracked text files scanned, ${findings.length} personal address(es)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
