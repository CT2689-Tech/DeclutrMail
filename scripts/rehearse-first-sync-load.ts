/**
 * Synthetic first-sync load rehearsal.
 *
 * One in-process worker, matching the launch max of one worker instance.
 * The adapter never calls Gmail, Postgres, or Redis. Do not point it at
 * production users. The Oct 14 staging walk with qa1–qa5 is a separate
 * manual procedure described in docs/runbooks/first-sync-load-rehearsal.md.
 */
import { pathToFileURL } from 'node:url';

const DEFAULT_MAILBOXES = 20;
const DEFAULT_EMAILS_PER_MAILBOX = 20;
const MAX_MAILBOXES = 100;
const MAX_EMAILS_PER_MAILBOX = 1000;
const SYNTHETIC_EMAIL_MS = 5;

export interface RehearsalOptions {
  mailboxes: number;
  emailsPerMailbox: number;
  fast: boolean;
  injectFailures: boolean;
}

export interface RehearsalReport {
  mailboxes: number;
  emails: number;
  queueWaitP50Ms: number;
  queueWaitP90Ms: number;
  completionP50Ms: number;
  completionP90Ms: number;
  peakRssBytes: number;
  failures: number;
}

interface SyntheticMessage {
  id: string;
}

/** Metadata-only stand-in. It has no network and no message body. */
export function createSyntheticGmail(): {
  listMetadata: (mailbox: string, count: number) => SyntheticMessage[];
} {
  return {
    listMetadata(mailbox, count) {
      return Array.from({ length: count }, (_, index) => ({ id: `${mailbox}-${index}` }));
    },
  };
}

/** Nearest-rank percentile. An empty sample is an error, not a zero. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('Empty percentile sample');
  if (p < 0 || p > 100) throw new Error('Percentile out of range');
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  const value = sorted[rank];
  if (value === undefined) throw new Error('Empty percentile sample');
  return value;
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function integerFlag(argv: readonly string[], name: string, fallback: number): number {
  const raw = flagValue(argv, name);
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}

export function parseRehearsalArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): RehearsalOptions {
  if (argv.includes('--production-users') || argv.includes('--production')) {
    throw new Error('Refusing a rehearsal against production users');
  }
  const project = env.GOOGLE_CLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT_ID ?? '';
  if (project === 'declutrmail-ai-prod') throw new Error('Refusing declutrmail-ai-prod');
  const fast = argv.includes('--fast');
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!fast && /supabase\.(co|com)/i.test(databaseUrl)) {
    throw new Error('Refusing a hosted Supabase URL without --fast');
  }
  const mailboxes = integerFlag(argv, '--mailboxes', DEFAULT_MAILBOXES);
  const emailsPerMailbox = integerFlag(argv, '--emails', DEFAULT_EMAILS_PER_MAILBOX);
  if (!Number.isInteger(mailboxes) || mailboxes < 1 || mailboxes > MAX_MAILBOXES) {
    throw new Error(`Mailboxes must be an integer from 1 to ${MAX_MAILBOXES}`);
  }
  if (
    !Number.isInteger(emailsPerMailbox) ||
    emailsPerMailbox < 1 ||
    emailsPerMailbox > MAX_EMAILS_PER_MAILBOX
  ) {
    throw new Error(`Emails per mailbox must be an integer from 1 to ${MAX_EMAILS_PER_MAILBOX}`);
  }
  return {
    mailboxes,
    emailsPerMailbox,
    fast,
    injectFailures: argv.includes('--inject-failures'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serial worker: launch keeps max instances at 1, so jobs wait on one consumer. */
export async function rehearse(options: RehearsalOptions): Promise<RehearsalReport> {
  const gmail = createSyntheticGmail();
  const perEmailMs = options.fast ? 0 : SYNTHETIC_EMAIL_MS;
  const enqueuedAt = options.fast ? 0 : Date.now();
  let clock = enqueuedAt;
  const queueWaits: number[] = [];
  const completions: number[] = [];
  let failures = 0;
  let peakRssBytes = process.memoryUsage().rss;
  for (let index = 0; index < options.mailboxes; index += 1) {
    const started = clock;
    queueWaits.push(started - enqueuedAt);
    const messages = gmail.listMetadata(`mailbox-${index}`, options.emailsPerMailbox);
    if (options.injectFailures && index === 0) {
      failures += 1;
      completions.push(started - enqueuedAt);
      continue;
    }
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      if (perEmailMs > 0) await sleep(perEmailMs);
      clock += perEmailMs;
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
    completions.push(clock - enqueuedAt);
  }
  return {
    mailboxes: options.mailboxes,
    emails: options.mailboxes * options.emailsPerMailbox,
    queueWaitP50Ms: percentile(queueWaits, 50),
    queueWaitP90Ms: percentile(queueWaits, 90),
    completionP50Ms: percentile(completions, 50),
    completionP90Ms: percentile(completions, 90),
    peakRssBytes,
    failures,
  };
}

async function main(): Promise<void> {
  const report = await rehearse(parseRehearsalArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
