import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  contentDigest,
  execute,
  reviewHtml,
  validateArticle,
  validateDraft,
  validateRegistry,
  verifyApproval,
} from './content-pipeline.mjs';

const TODAY = '2026-10-30';
const article = () => ({
  slug: 'gmail-search-checklist',
  path: '/blog/gmail-search-checklist',
  kind: 'Article',
  publishedAt: TODAY,
  updatedAt: TODAY,
  title: 'Review a Gmail search',
  description: 'A concrete review checklist.',
  intro: 'Check the scope before choosing an action.',
  readingMinutes: 3,
  sections: [
    {
      id: 'criteria',
      title: 'Choose the criteria',
      paragraphs: ['Use a sender, date and location that match the task.'],
    },
    {
      id: 'review',
      title: 'Review the matches',
      paragraphs: ['Inspect the matches before changing them.'],
    },
  ],
  sources: [
    {
      href: 'https://support.google.com/mail/answer/7190',
      label: 'Gmail search',
      description: 'Official operator reference.',
    },
  ],
  related: [
    {
      href: '/how-to/clean-gmail-by-sender',
      label: 'Sender cleanup',
      description: 'Review recurring senders.',
    },
  ],
});
const draft = () => ({
  version: 1,
  id: 'gmail-search-checklist',
  kind: 'article',
  rationale: 'People need to verify a bulk scope.',
  distinctValue: 'A reusable query review worksheet.',
  evidence: [
    {
      reference: 'https://support.google.com/mail/answer/7190',
      supports: 'Gmail operators',
      observedAt: TODAY,
    },
  ],
  article: article(),
});
const approval = (d) => ({
  version: 1,
  draftId: d.id,
  contentSha256: contentDigest(d),
  destination: 'https://declutrmail.com' + d.article.path,
  founder: {
    decision: 'approved',
    approvedAt: TODAY,
    evidenceRef: 'Actual founder message reference',
  },
  content: {
    decision: 'approved',
    approvedAt: TODAY,
    evidenceRef: 'Actual Content owner-deck sign-off reference',
  },
  additionalSpend: 0,
});

test('drafts need evidence, distinct value and structurally valid public content', () => {
  assert.equal(validateDraft(draft(), TODAY).kind, 'article');
  assert.throws(() => validateDraft({ ...draft(), evidence: [] }, TODAY), /evidence/);
  assert.throws(() => validateArticle({ ...article(), path: '/privacy' }, TODAY), /slug\/path/);
  assert.throws(() => validateArticle({ ...article(), updatedAt: '2026-11-01' }, TODAY), /dates/);
  assert.throws(
    () =>
      validateArticle(
        { ...article(), sections: [article().sections[0], article().sections[0]] },
        TODAY,
      ),
    /unique/,
  );
});

test('unknown nested public fields and unsafe source links cannot leak into publication', () => {
  const a = article();
  a.sources[0].privateEvidence = 'private';
  assert.throws(() => validateArticle(a, TODAY), /Unknown public/);
  const b = article();
  b.sources[0].href = 'javascript:alert(1)';
  assert.throws(() => validateArticle(b, TODAY), /HTTPS/);
  const unsafeRelative = article();
  unsafeRelative.related[0].href = '/\\evil.example';
  assert.throws(() => validateArticle(unsafeRelative, TODAY), /HTTPS/);
  const c = article();
  c.example = { label: 'Customer results', caption: 'Fake proof', rows: [] };
  assert.throws(() => validateArticle(c, TODAY), /fictional/);
});

test('approval binds exact words, destination, Content sign-off and zero spend', () => {
  const d = draft();
  const a = approval(d);
  assert.equal(verifyApproval(d, a, TODAY), a);
  assert.throws(
    () =>
      verifyApproval({ ...d, article: { ...d.article, title: 'Changed after review' } }, a, TODAY),
    /exact content/,
  );
  assert.throws(
    () => verifyApproval(d, { ...a, destination: 'https://other.example/' }, TODAY),
    /destination/,
  );
  assert.throws(() => verifyApproval(d, { ...a, content: undefined }, TODAY), /content approval/);
  assert.throws(
    () => verifyApproval(d, { ...a, founder: { ...a.founder, decision: 'pending' } }, TODAY),
    /founder approval/,
  );
  assert.throws(() => verifyApproval(d, { ...a, additionalSpend: 1 }, TODAY), /zero/);
});

test('private review escapes injected markup and cannot publish', () => {
  const d = draft();
  d.article.title = '<script>run()</script>';
  const html = reviewHtml(d);
  assert.equal(html.includes('<script>run()'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Not published/);
  assert.ok(html.includes(contentDigest(d)));
  assert.ok(html.includes('https://declutrmail.com' + d.article.path));
  assert.ok(html.includes('Updated: ' + d.article.updatedAt));
  assert.match(html, /preview itself cannot publish/);
});

test('public registry rejects changed payloads, duplicate slugs and private receipt fields', () => {
  const d = draft();
  const entry = {
    article: d.article,
    draftId: d.id,
    contentSha256: contentDigest(d),
    approvedAt: TODAY,
    contentReviewedAt: TODAY,
  };
  assert.equal(validateRegistry({ version: 1, articles: [entry] }, TODAY).articles.length, 1);
  assert.throws(
    () =>
      validateRegistry(
        { version: 1, articles: [{ ...entry, article: { ...entry.article, title: 'Other' } }] },
        TODAY,
      ),
    /digest/,
  );
  assert.throws(
    () => validateRegistry({ version: 1, articles: [entry, entry] }, TODAY),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateRegistry(
        { version: 1, articles: [{ ...entry, approval: { private: 'reference' } }] },
        TODAY,
      ),
    /Private/,
  );
});

test('approved staging publishes only the intended public record and is idempotent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-pipeline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const dir = path.join(repo, 'apps/web/src/features/marketing/learn');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(repo, '.git'), 'gitdir: isolated-worktree');
  const registry = path.join(dir, 'published-blog.json');
  await writeFile(registry, JSON.stringify({ version: 1, articles: [] }));
  await writeFile(path.join(dir, 'blog-content.ts'), "export const LEGACY=['legacy-essay'];");
  const input = path.join(root, 'input.json');
  const d = draft();
  await writeFile(input, JSON.stringify(d));
  const options = { stateDir: path.join(root, 'private'), input, repo, id: d.id };
  const deps = { today: TODAY };
  await execute('ingest', options, deps);
  await execute('ingest', options, deps);
  assert.equal((await execute('status', options, deps)).items.length, 1);
  await assert.rejects(
    execute('stage-approved', { ...options, approval: path.join(root, 'missing.json') }, deps),
  );
  assert.equal(JSON.parse(await readFile(registry, 'utf8')).articles.length, 0);
  const receipt = path.join(root, 'approval.json');
  await writeFile(receipt, JSON.stringify(approval(d)));
  await execute('stage-approved', { ...options, approval: receipt }, deps);
  await execute('stage-approved', { ...options, approval: receipt }, deps);
  const result = JSON.parse(await readFile(registry, 'utf8'));
  assert.equal(result.articles.length, 1);
  assert.equal(JSON.stringify(result).includes('Actual founder'), false);
  assert.equal((await execute('status', options, deps)).items[0].status, 'staged_for_pr');
  d.article.title = 'Revision';
  await writeFile(input, JSON.stringify(d));
  await execute('ingest', options, deps);
  assert.equal((await execute('status', options, deps)).items[0].status, 'awaiting_review');
  await assert.rejects(
    execute('stage-approved', { ...options, approval: receipt }, deps),
    /exact content/,
  );
  await assert.rejects(execute('publish', options, deps), /Unknown command/);
  await writeFile(path.join(options.stateDir, 'run.lock'), 'other writer');
  await assert.rejects(execute('status', options, deps), { code: 'EEXIST' });
});

test('directory image changes invalidate approval and image-only work cannot alter copy', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'directory-packet-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1920, 16);
  png.writeUInt32BE(1080, 20);
  const file = path.join(root, 'capture.png');
  await writeFile(file, png);
  const d = {
    version: 1,
    id: 'saashub-gallery',
    kind: 'directory',
    rationale: 'Tall images are unreadable.',
    distinctValue: 'A focused gallery.',
    evidence: [
      { reference: 'public-gallery', supports: 'Existing image presentation', observedAt: TODAY },
    ],
    directory: {
      name: 'SaaSHub',
      url: 'https://www.saashub.com/declutrmail',
      action: 'replace_images',
      images: [
        {
          id: 'sender-review',
          file: 'capture.png',
          sha256: createHash('sha256').update(png).digest('hex'),
          caption: 'Fictional demo',
          alt: 'Actual UI with fictional data',
          dataKind: 'fictional_product_demo',
        },
      ],
    },
  };
  validateDraft(d, TODAY);
  assert.throws(
    () =>
      validateDraft(
        { ...d, directory: { ...d.directory, description: 'Sneaky copy edit' } },
        TODAY,
      ),
    /silently/,
  );
  const input = path.join(root, 'draft.json');
  await writeFile(input, JSON.stringify(d));
  const opts = { stateDir: path.join(root, 'private'), input, id: d.id, assetDir: root };
  const deps = { today: TODAY };
  await execute('ingest', opts, deps);
  const receipt = {
    ...approval({ ...d, article: { path: '/unused' } }),
    destination: d.directory.url,
  };
  const approved = path.join(root, 'approval.json');
  await writeFile(approved, JSON.stringify(receipt));
  await execute('directory-packet', { ...opts, approval: approved }, deps);
  png[23] = 1;
  await writeFile(file, png);
  await assert.rejects(
    execute('directory-packet', { ...opts, approval: approved }, deps),
    /changed after review/,
  );
});

test('committed registry validates for initial and future approved publications', async () => {
  const registry = JSON.parse(
    await readFile(
      new URL('../apps/web/src/features/marketing/learn/published-blog.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(validateRegistry(registry).articles.length, registry.articles.length);
});

test('the review queue refuses a fourth item but permits revising an existing item', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'content-cap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input.json');
  const opts = { stateDir: path.join(root, 'private'), input };
  const deps = { today: TODAY };
  for (const id of ['first', 'second', 'third']) {
    await writeFile(input, JSON.stringify({ ...draft(), id }));
    await execute('ingest', opts, deps);
  }
  await writeFile(input, JSON.stringify({ ...draft(), id: 'fourth' }));
  await assert.rejects(execute('ingest', opts, deps), /Three drafts/);
  const revised = { ...draft(), id: 'first' };
  revised.article.title = 'Revised first article';
  await writeFile(input, JSON.stringify(revised));
  const result = await execute('ingest', opts, deps);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].status, 'awaiting_review');
});
