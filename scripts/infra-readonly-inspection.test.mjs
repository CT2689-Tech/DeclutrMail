import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectInfrastructure,
  nonPaymentEnv,
  projectSnapshot,
} from './infra-readonly-inspection.mjs';
import { encryptReport } from './sentry-private-triage.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const privateMarker = 'PRIVATE_REFLECTED_ERROR_AND_UNKNOWN_FIELD_DO_NOT_EXPORT';
const names = [
  'Google Cloud (project charges)',
  'Supabase (DB size)',
  'Google Cloud (budgets)',
  'Upstash Redis',
  'Anthropic',
  'Vercel',
  'Sentry',
  'PostHog',
  'GitHub Actions',
  'Paddle (webhooks)',
  'Razorpay (webhooks)',
];
const snapshot = () => ({
  version: 1,
  observedAt: '2026-10-06T13:00:00.000Z',
  vendors: names.map((name) => ({
    name,
    status: 'UNCONFIGURED',
    costMtdUsd: null,
    usage: {},
    detail: privateMarker,
  })),
});
const env = { INFRA_INSPECTION_PUBLIC_KEY: publicKey };
const fakeExec = (data) => (_exe, _args, opts) =>
  writeFileSync(opts.env.INFRA_SNAPSHOT_PATH, JSON.stringify(data));
function decrypt(envelope, aad = envelope.aad) {
  const key = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelope.wrappedKey, 'base64'),
  );
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString(),
  );
}

test('payment values are never read or forwarded; unrelated access stays scoped and summaries are disabled', () => {
  const input = new Proxy(
    {
      PATH: '/synthetic',
      PADDLE_API_KEY: 'ignored',
      PADDLE_CLIENT_TOKEN: 'ignored',
      RAZORPAY_KEY_SECRET: 'ignored',
      razorpay_other: 'ignored',
      GITHUB_STEP_SUMMARY: '/private/summary',
      INFRA_INSPECTION_PUBLIC_KEY: publicKey,
    },
    {
      get(target, name) {
        if (/^(PADDLE|RAZORPAY)_/i.test(String(name))) throw new Error('payment value read');
        return target[name];
      },
    },
  );
  assert.deepEqual(nonPaymentEnv(input), {
    PATH: '/synthetic',
    PADDLE_ENV: 'sandbox',
    GITHUB_STEP_SUMMARY: '',
  });
});

test('invalid, private and weak public keys fail before any collector starts', () => {
  const weak = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  let calls = 0;
  for (const pem of [undefined, privateMarker, privateKey, weak.publicKey])
    assert.throws(() =>
      inspectInfrastructure({ env: { INFRA_INSPECTION_PUBLIC_KEY: pem }, execImpl: () => calls++ }),
    );
  assert.equal(calls, 0);
});

test('projection retains current known numeric observations but never copies raw errors, unknown names or payment rows', () => {
  const data = snapshot();
  Object.assign(data.vendors[3], {
    status: 'WARN',
    costMtdUsd: 12.25,
    usage: { commands_today: 200, [privateMarker]: 4 },
  });
  const projected = projectSnapshot(data);
  assert.equal(projected.vendors.length, 9);
  assert.deepEqual(projected.vendors[3], {
    name: 'Upstash Redis',
    status: 'WARN',
    costMtdUsd: 12.25,
    usage: { commands_today: 200 },
    omittedUsageFields: 1,
  });
  assert.ok(!JSON.stringify(projected).includes(privateMarker));
  for (const mutation of [
    (d) => d.vendors.push(d.vendors[0]),
    (d) => d.vendors.pop(),
    (d) => (d.vendors[0].name = privateMarker),
    (d) => (d.vendors[0].status = privateMarker),
    (d) => (d.vendors[0].costMtdUsd = privateMarker),
    (d) => (d.vendors[0].usage = { commands_today: privateMarker }),
    (d) => (d.observedAt = privateMarker),
    (d) => (d.vendors[9].status = 'OK'),
    (d) => (d.vendors[10].usage = { commands_today: 1 }),
  ]) {
    const broken = snapshot();
    mutation(broken);
    assert.throws(() => projectSnapshot(broken));
  }
});

test('existing native collector errors stay silent; valid snapshot and nonzero failure remain visible', () => {
  let sourcePath;
  const { report, exitCode } = inspectInfrastructure({
    env: { ...env, PADDLE_API_KEY: privateMarker, RAZORPAY_KEY_ID: privateMarker },
    execImpl(exe, args, opts) {
      sourcePath = opts.env.INFRA_SNAPSHOT_PATH;
      assert.equal(args.length, 1);
      assert.ok(args[0].endsWith('/scripts/check-vendor-limits.mjs'));
      assert.deepEqual(opts.stdio, ['ignore', 'ignore', 'ignore']);
      assert.equal(opts.timeout, 120_000);
      assert.equal(opts.killSignal, 'SIGKILL');
      assert.equal(opts.env.PADDLE_API_KEY, undefined);
      assert.equal(opts.env.RAZORPAY_KEY_ID, undefined);
      assert.equal(opts.env.GITHUB_STEP_SUMMARY, '');
      execFileSync(
        exe,
        [
          '-e',
          'console.log(process.env.SYNTHETIC_PRIVATE); console.error(process.env.SYNTHETIC_PRIVATE); require("node:fs").writeFileSync(process.env.INFRA_SNAPSHOT_PATH,process.env.SYNTHETIC_SOURCE); process.exit(1);',
        ],
        {
          ...opts,
          env: {
            ...opts.env,
            SYNTHETIC_PRIVATE: privateMarker,
            SYNTHETIC_SOURCE: JSON.stringify(snapshot()),
          },
        },
      );
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(report.processExitCode, 1);
  assert.equal(report.collectionStatus, 'collected');
  assert.equal(report.paymentProvidersRead, false);
  assert.equal(report.monitoringPublished, false);
  assert.equal(report.dailyCollectorRecoveryVerified, false);
  assert.ok(!JSON.stringify(report).includes(privateMarker));
  assert.ok(!existsSync(sourcePath));
});

test('missing, malformed, oversized, timed-out and failed collection retain closed unavailable evidence', () => {
  for (const [execImpl, reason] of [
    [() => {}, 'snapshot_unavailable_or_invalid'],
    [
      (_a, _b, o) => writeFileSync(o.env.INFRA_SNAPSHOT_PATH, privateMarker),
      'snapshot_unavailable_or_invalid',
    ],
    [
      (_a, _b, o) => writeFileSync(o.env.INFRA_SNAPSHOT_PATH, 'x'.repeat(65537)),
      'snapshot_unavailable_or_invalid',
    ],
    [
      () => {
        throw { code: 'ETIMEDOUT', signal: 'SIGKILL', status: null, message: privateMarker };
      },
      'collector_deadline',
    ],
    [
      () => {
        throw { signal: 'SIGTERM', status: null, message: privateMarker };
      },
      'collector_failed',
    ],
    [
      () => {
        throw { code: 'ENOENT', message: privateMarker };
      },
      'collector_unavailable',
    ],
    [
      () => {
        throw { status: 23, message: privateMarker };
      },
      'collector_failed',
    ],
  ]) {
    const result = inspectInfrastructure({ env, execImpl });
    assert.equal(result.exitCode, 2);
    assert.equal(result.report.collectionStatus, 'unavailable');
    assert.equal(result.report.unavailableReason, reason);
    assert.deepEqual(result.report.vendors, []);
    assert.ok(!JSON.stringify(result).includes(privateMarker));
  }
});

test('native termination differs from a deadline and intercepted SIGTERM cannot prevent deadline cleanup', () => {
  for (const [script, timeout, reason] of [
    ['process.kill(process.pid, "SIGTERM")', 3000, 'collector_failed'],
    ['process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)', 200, 'collector_deadline'],
  ]) {
    let sourcePath;
    const result = inspectInfrastructure({
      env,
      execImpl(exe, _args, opts) {
        sourcePath = opts.env.INFRA_SNAPSHOT_PATH;
        execFileSync(exe, ['-e', script], { ...opts, timeout });
      },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.report.unavailableReason, reason);
    assert.equal(result.report.processExitCode, null);
    assert.ok(!existsSync(sourcePath));
  }
});

test('infrastructure encryption roundtrips with its own authenticated context and rejects context substitution', () => {
  const { report } = inspectInfrastructure({ env, execImpl: fakeExec(snapshot()) });
  const sealed = encryptReport(report, publicKey, 'infra-readonly');
  assert.equal(sealed.aad, 'declutrmail:infra-readonly:v1');
  assert.deepEqual(decrypt(sealed), report);
  assert.throws(() => decrypt(sealed, 'declutrmail:sentry-triage:v1'));
  assert.throws(() => encryptReport(report, publicKey, '__proto__'));
  assert.equal(encryptReport({}, publicKey).aad, 'declutrmail:sentry-triage:v1');
  assert.ok(!JSON.stringify(sealed).includes('costMtdUsd'));
});

test('native CLI with all credentials absent writes only an encrypted report and no summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'infra-inspection-cli-'));
  try {
    const output = join(dir, 'encrypted.json'),
      summary = join(dir, 'summary.md');
    writeFileSync(summary, 'unchanged');
    const result = spawnSync(process.execPath, ['scripts/infra-readonly-inspection.mjs', output], {
      env: { PATH: process.env.PATH, ...env, GITHUB_STEP_SUMMARY: summary },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const decoded = decrypt(JSON.parse(readFileSync(output, 'utf8')));
    assert.equal(decoded.vendors.length, 9);
    assert.ok(decoded.vendors.every((row) => row.status === 'UNCONFIGURED'));
    assert.equal(readFileSync(summary, 'utf8'), 'unchanged');
    assert.match(result.stdout, /^Encrypted infrastructure inspection saved \(collected\)\.\s*$/);
    assert.ok(!result.stdout.includes('Supabase'));
    assert.equal(result.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual main-only workflow binds no payment secrets, grants no policies and uploads only an encrypted short-lived artifact', () => {
  const wf = readFileSync('.github/workflows/infra-readonly-inspection.yml', 'utf8');
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(wf, /contents: read\s+id-token: write/);
  assert.match(wf, /cancel-in-progress: false/);
  assert.match(wf, /INFRA_INSPECTION_PUBLIC_KEY: \$\{\{ inputs\.public_key \}\}/);
  assert.match(wf, /path: \$\{\{ runner\.temp \}\}\/infra-inspection\.encrypted\.json/);
  assert.match(wf, /retention-days: 1/);
  assert.match(wf, /if: always\(\)/);
  assert.ok(wf.indexOf('Validate caller public key') < wf.indexOf('Authenticate using existing'));
  assert.ok(
    !/PADDLE|RAZORPAY|schedule:|infra-observability\.mjs|private-finance-report\.mjs|add-iam-policy-binding|continue-on-error/.test(
      wf,
    ),
  );
  const allowed = new Set([
    'GCP_WIF_PROVIDER',
    'GCP_DEPLOY_SA',
    'SUPABASE_SESSION_DSN',
    'GCP_BILLING_ACCOUNT_ID',
    'UPSTASH_EMAIL',
    'UPSTASH_API_KEY',
    'ANTHROPIC_ADMIN_KEY',
    'VERCEL_TOKEN',
    'VERCEL_TEAM_ID',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'POSTHOG_API_KEY',
    'POSTHOG_PROJECT_ID',
    'POSTHOG_HOST',
    'GH_BILLING_PAT',
  ]);
  for (const match of wf.matchAll(/secrets\.([A-Z0-9_]+)/g))
    assert.ok(allowed.has(match[1]), match[1]);
  for (const [, expression] of wf.matchAll(/\$\{\{\s*([^}]+)\}\}/g)) {
    const value = expression.trim();
    assert.ok(
      ['inputs.public_key', 'vars.GCP_BILLING_EXPORT_TABLE', 'runner.temp'].includes(value) ||
        (value.startsWith('secrets.') && allowed.has(value.slice(8))),
      'unexpected expression',
    );
  }
  assert.ok(
    readFileSync('.github/workflows/ci.yml', 'utf8').includes(
      'node --test scripts/infra-readonly-inspection.test.mjs',
    ),
  );
});
