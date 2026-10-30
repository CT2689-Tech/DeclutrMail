#!/usr/bin/env node
// Local drafting/review/staging only. External publication uses the normal PR
// workflow after explicit founder approval and Content sign-off of exact bytes.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pacificDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const REGISTRY = 'apps/web/src/features/marketing/learn/published-blog.json';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const date = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const text = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 18000;
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const keysOnly = (row, keys) =>
  check(
    row && typeof row === 'object' && Object.keys(row).every((k) => keys.includes(k)),
    'Unknown public content field',
  );
const PUBLIC_KEYS = [
  'slug',
  'path',
  'publishedAt',
  'updatedAt',
  'kind',
  'title',
  'description',
  'intro',
  'quickAnswer',
  'readingMinutes',
  'sections',
  'example',
  'sources',
  'related',
];

function link(row) {
  keysOnly(row, ['href', 'label', 'description']);
  check(text(row.label) && text(row.description), 'Links require descriptive labels');
  check(
    typeof row.href === 'string' &&
      !row.href.includes('\\') &&
      [...row.href].every((character) => character.charCodeAt(0) > 32) &&
      ((row.href.startsWith('/') && !row.href.startsWith('//')) || /^https:\/\//.test(row.href)),
    'Only site-relative or HTTPS links are permitted',
  );
  if (row.href.startsWith('https:')) {
    const url = new URL(row.href);
    check(
      !url.username && !url.password && !url.port,
      'External links cannot contain credentials or custom ports',
    );
  }
}

export function validateArticle(article, today = pacificDate()) {
  check(article && typeof article === 'object', 'Article required');
  check(
    Object.keys(article).every((k) => PUBLIC_KEYS.includes(k)),
    'Unknown article field',
  );
  check(
    ID.test(article.slug) && article.path === `/blog/${article.slug}`,
    'Article slug/path mismatch',
  );
  check(article.kind === 'Article', 'New pipeline blog content must use Article');
  check(
    date(article.publishedAt) &&
      date(article.updatedAt) &&
      article.publishedAt <= article.updatedAt &&
      article.updatedAt <= today,
    'Invalid or future article dates',
  );
  for (const key of ['title', 'description', 'intro'])
    check(text(article[key]), `Article ${key} required`);
  check(
    article.title.length <= 140 && article.description.length <= 320,
    'Title/description too long',
  );
  check(
    Number.isInteger(article.readingMinutes) &&
      article.readingMinutes >= 1 &&
      article.readingMinutes <= 60,
    'Invalid reading time',
  );
  check(
    Array.isArray(article.sections) &&
      article.sections.length >= 2 &&
      article.sections.length <= 24,
    'Article requires 2–24 sections',
  );
  const ids = new Set();
  for (const section of article.sections) {
    check(ID.test(section.id) && !ids.has(section.id), 'Section IDs must be unique');
    ids.add(section.id);
    check(
      text(section.title) &&
        Array.isArray(section.paragraphs) &&
        section.paragraphs.length &&
        section.paragraphs.every(text),
      'Section title and paragraphs required',
    );
    if (section.bullets)
      check(Array.isArray(section.bullets) && section.bullets.every(text), 'Invalid bullet list');
    if (section.steps) {
      check(
        Array.isArray(section.steps) && section.steps.every((s) => text(s.name) && text(s.text)),
        'Invalid steps',
      );
      section.steps.forEach((s) => keysOnly(s, ['name', 'text']));
    }
    if (section.callout) {
      check(
        text(section.callout.title) &&
          text(section.callout.body) &&
          (!section.callout.tone || ['info', 'warning', 'truth'].includes(section.callout.tone)),
        'Invalid callout',
      );
      keysOnly(section.callout, ['title', 'body', 'tone']);
    }
    check(
      Object.keys(section).every((k) =>
        ['id', 'title', 'paragraphs', 'bullets', 'steps', 'callout'].includes(k),
      ),
      'Unknown section field',
    );
  }
  check(Array.isArray(article.sources) && article.sources.length >= 1, 'Primary sources required');
  check(
    Array.isArray(article.related) && article.related.length >= 1,
    'Relevant internal links required',
  );
  [...article.sources, ...article.related].forEach(link);
  if (article.quickAnswer) check(text(article.quickAnswer), 'Invalid quick answer');
  if (article.example) {
    keysOnly(article.example, ['label', 'caption', 'rows']);
    check(
      article.example.label === 'Made-up example' &&
        text(article.example.caption) &&
        Array.isArray(article.example.rows),
      'Examples must be visibly fictional',
    );
    for (const row of article.example.rows) {
      keysOnly(row, ['sender', 'detail', 'action', 'result']);
      for (const key of ['sender', 'detail', 'action', 'result'])
        check(text(row[key]), 'Invalid fictional example');
    }
  }
  return article;
}

export function validateDraft(draft, today = pacificDate()) {
  keysOnly(draft, [
    'version',
    'id',
    'kind',
    'rationale',
    'distinctValue',
    'evidence',
    'article',
    'directory',
  ]);
  check(draft.version === 1 && ID.test(draft.id), 'Invalid draft ID/version');
  check(['article', 'directory'].includes(draft.kind), 'Invalid draft kind');
  check(
    text(draft.rationale) && text(draft.distinctValue),
    'Explain the demand and distinct value',
  );
  check(Array.isArray(draft.evidence) && draft.evidence.length > 0, 'Research evidence required');
  for (const source of draft.evidence) {
    check(
      text(source.reference) &&
        text(source.supports) &&
        date(source.observedAt) &&
        source.observedAt <= today,
      'Evidence needs source, claim and actual observation date',
    );
  }
  if (draft.kind === 'article') validateArticle(draft.article, today);
  else {
    keysOnly(draft.directory, [
      'name',
      'url',
      'action',
      'images',
      'tagline',
      'description',
      'website',
      'categories',
      'platforms',
      'pricingModel',
    ]);
    check(
      draft.directory && ['replace_images', 'new_listing'].includes(draft.directory.action),
      'Invalid directory action',
    );
    const url = new URL(draft.directory.url);
    check(
      url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        [
          'saashub.com',
          'www.saashub.com',
          'alternativeto.net',
          'www.alternativeto.net',
          'producthunt.com',
          'www.producthunt.com',
          'fazier.com',
          'www.fazier.com',
          'sourceforge.net',
          'www.sourceforge.net',
        ].includes(url.hostname),
      'Directory destination must be exact public HTTPS URL',
    );
    check(
      text(draft.directory.name) &&
        Array.isArray(draft.directory.images) &&
        draft.directory.images.length > 0 &&
        draft.directory.images.length <= 8,
      'Directory images required',
    );
    for (const image of draft.directory.images) {
      keysOnly(image, ['id', 'file', 'sha256', 'caption', 'alt', 'dataKind']);
      check(
        ID.test(image.id) &&
          text(image.file) &&
          /^[a-f\d]{64}$/.test(image.sha256) &&
          text(image.caption) &&
          text(image.alt),
        'Image requires ID, file, SHA-256, caption and alt text',
      );
      check(
        image.dataKind === 'fictional_product_demo',
        'Directory images must have explicit fictional-demo provenance',
      );
    }
    if (draft.directory.action === 'new_listing') {
      check(
        text(draft.directory.tagline) && text(draft.directory.description),
        'New listing needs reviewed copy',
      );
      check(
        draft.directory.website === 'https://declutrmail.com/' &&
          draft.directory.pricingModel === 'Freemium' &&
          Array.isArray(draft.directory.categories) &&
          draft.directory.categories.length > 0 &&
          draft.directory.categories.every(text) &&
          Array.isArray(draft.directory.platforms) &&
          draft.directory.platforms.length === 1 &&
          draft.directory.platforms[0] === 'Web',
        'New listing requires the canonical website, reviewed categories, Web platform and Freemium pricing model',
      );
    }
    if (draft.directory.action === 'replace_images')
      check(
        !draft.directory.tagline && !draft.directory.description,
        'Image-only replacement cannot silently rewrite listing copy',
      );
  }
  return draft;
}

export function contentDigest(draft) {
  return hash({
    version: draft.version,
    kind: draft.kind,
    id: draft.id,
    payload: draft.kind === 'article' ? draft.article : draft.directory,
  });
}

export function verifyApproval(draft, approval, today = pacificDate()) {
  validateDraft(draft, today);
  check(
    approval.version === 1 &&
      approval.draftId === draft.id &&
      approval.contentSha256 === contentDigest(draft),
    'Approval does not match this exact content version',
  );
  check(
    approval.destination ===
      (draft.kind === 'article'
        ? `https://declutrmail.com${draft.article.path}`
        : draft.directory.url),
    'Approval destination mismatch',
  );
  for (const role of ['founder', 'content']) {
    const receipt = approval[role];
    check(
      receipt?.decision === 'approved' &&
        text(receipt.evidenceRef) &&
        date(receipt.approvedAt) &&
        receipt.approvedAt <= today,
      `${role} approval and its actual evidence reference are required`,
    );
  }
  check(approval.additionalSpend === 0, 'Only zero-additional-spend publication is permitted');
  return approval;
}

export function validateRegistry(registry, today = pacificDate()) {
  keysOnly(registry, ['version', 'articles']);
  check(registry.version === 1 && Array.isArray(registry.articles), 'Invalid public registry');
  const slugs = new Set();
  for (const entry of registry.articles) {
    validateArticle(entry.article, today);
    check(!slugs.has(entry.article.slug), 'Duplicate article slug');
    slugs.add(entry.article.slug);
    check(
      entry.contentSha256 ===
        contentDigest({ version: 1, kind: 'article', id: entry.draftId, article: entry.article }),
      'Published content digest mismatch',
    );
    check(
      date(entry.approvedAt) &&
        date(entry.contentReviewedAt) &&
        entry.approvedAt <= today &&
        entry.contentReviewedAt <= today,
      'Public approval timestamps required',
    );
    check(
      Object.keys(entry).every((k) =>
        ['article', 'draftId', 'contentSha256', 'approvedAt', 'contentReviewedAt'].includes(k),
      ),
      'Private evidence/approval fields must not enter public registry',
    );
  }
  return registry;
}

function articleMarkup(a) {
  return (
    `<h1>${escape(a.title)}</h1><p>${escape(a.readingMinutes)} minute read · Proposed page date: ${escape(a.publishedAt)}</p><p class="lede">${escape(a.intro)}</p><p>${escape(a.description)}</p>` +
    (a.quickAnswer ? `<aside>${escape(a.quickAnswer)}</aside>` : '') +
    a.sections
      .map(
        (s) =>
          `<section><h2>${escape(s.title)}</h2>${s.paragraphs.map((p) => `<p>${escape(p)}</p>`).join('')}${s.bullets ? `<ul>${s.bullets.map((p) => `<li>${escape(p)}</li>`).join('')}</ul>` : ''}${s.steps ? `<ol>${s.steps.map((p) => `<li><strong>${escape(p.name)}</strong> ${escape(p.text)}</li>`).join('')}</ol>` : ''}${s.callout ? `<aside><strong>${escape(s.callout.title)}</strong><p>${escape(s.callout.body)}</p></aside>` : ''}</section>`,
      )
      .join('') +
    (a.example
      ? `<section><h2>${escape(a.example.label)}</h2><p>${escape(a.example.caption)}</p><ul>${a.example.rows.map((r) => `<li>${escape([r.sender, r.detail, r.action, r.result].join(' · '))}</li>`).join('')}</ul></section>`
      : '') +
    `<h2>Sources</h2><ul>${a.sources.map((l) => `<li><a href="${escape(l.href)}">${escape(l.label)}</a> — ${escape(l.description)}</li>`).join('')}</ul><h2>Related reading</h2><ul>${a.related.map((l) => `<li><a href="${escape(l.href.startsWith('/') ? 'https://declutrmail.com' + l.href : l.href)}">${escape(l.label)}</a> — ${escape(l.description)}</li>`).join('')}</ul>`
  );
}

export function reviewHtml(draft, images = []) {
  const title =
    draft.kind === 'article'
      ? draft.article.title
      : `${draft.directory.name} image and listing review`;
  const body =
    draft.kind === 'article'
      ? articleMarkup(draft.article)
      : `<h1>${escape(title)}</h1><p>${escape(draft.directory.url)}</p><p>${draft.directory.action === 'replace_images' ? 'Replace the gallery images. Keep the existing listing wording and website link.' : 'Proposed new listing. Nothing has been submitted.'}</p>` +
        (draft.directory.tagline
          ? `<h2>${escape(draft.directory.tagline)}</h2><p>${escape(draft.directory.description)}</p><p>Website: ${escape(draft.directory.website)}</p><p>Categories: ${escape(draft.directory.categories.join(', '))}</p><p>Platforms: ${escape(draft.directory.platforms.join(', '))} · Pricing model: ${escape(draft.directory.pricingModel)}</p>`
          : '') +
        images
          .map(
            (image, i) =>
              `<figure><img src="data:image/png;base64,${image}" alt="${escape(draft.directory.images[i].alt)}"><figcaption>${escape(draft.directory.images[i].caption)}<details><summary>Image description</summary>${escape(draft.directory.images[i].alt)}</details></figcaption></figure>`,
          )
          .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} — private review</title><style>body{margin:0;background:#f6f3ee;color:#28252b;font:18px/1.65 Georgia,serif}header{padding:20px 6vw;background:#51415f;color:#fff;font:16px/1.6 system-ui}main{max-width:850px;margin:48px auto;padding:0 28px 80px}h1{font-size:44px;line-height:1.12;letter-spacing:-1px}h2{font-size:27px;margin-top:38px}a{color:#51415f}aside{background:#eae3ef;padding:20px;border-radius:12px}img{width:100%;height:auto;border:1px solid #d7cfdd;border-radius:12px}figure{margin:30px 0}figcaption{font:15px/1.5 system-ui;color:#655c6c}.lede{font-size:23px}footer{border-top:1px solid #d7cfdd;padding-top:24px;font:16px/1.6 system-ui}code{overflow-wrap:anywhere}</style><header>DeclutrMail · Private draft · Not published</header><main>${body}<footer><p><strong>Review ${escape(draft.id)}</strong></p><p>Publication requires your approval of this version and Content sign-off. Changes after approval require another review. No additional spending, outreach or account changes are included.</p><p>To approve, identify this draft in the chat. This preview itself cannot publish anything.</p></footer></main></html>`;
}

async function readJson(filename) {
  const bytes = await readFile(filename);
  check(bytes.length <= 2 * 1024 * 1024, 'JSON input exceeds 2 MiB');
  return JSON.parse(bytes.toString('utf8'));
}

async function atomic(filename, value) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temp, value, { mode: 0o600, flag: 'wx' });
  await rename(temp, filename);
}

async function privateRoot(directory) {
  check(directory, '--state-dir is required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolved = await realpath(directory);
  for (let p = resolved; ; p = path.dirname(p)) {
    check(!existsSync(path.join(p, '.git')), 'Draft state must be outside Git');
    if (p === path.dirname(p)) break;
  }
  return resolved;
}

async function imageBytes(draft, base) {
  if (draft.kind !== 'directory') return [];
  const root = await realpath(base);
  return Promise.all(
    draft.directory.images.map(async (image) => {
      const file = await realpath(path.resolve(root, image.file));
      check(file.startsWith(root + path.sep), 'Image must be inside the input asset directory');
      const bytes = await readFile(file);
      check(
        bytes.length <= 8 * 1024 * 1024 &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        'Only bounded PNG assets are accepted',
      );
      check(
        createHash('sha256').update(bytes).digest('hex') === image.sha256,
        'Image changed after review',
      );
      check(
        bytes.readUInt32BE(16) >= 1200 && bytes.readUInt32BE(20) >= 600,
        'Directory asset dimensions are too small',
      );
      return bytes.toString('base64');
    }),
  );
}

export async function execute(command, options, dependencies = {}) {
  const today = dependencies.today || pacificDate();
  if (command === 'check-registry')
    return {
      articles: validateRegistry(await readJson(path.join(options.repo || ROOT, REGISTRY)), today)
        .articles.length,
    };
  const root = await privateRoot(options.stateDir);
  const lockFile = path.join(root, 'run.lock');
  const lock = await open(lockFile, 'wx', 0o600);
  try {
    const stateFile = path.join(root, 'state.json');
    const state = existsSync(stateFile) ? await readJson(stateFile) : { version: 1, items: [] };
    check(state.version === 1 && Array.isArray(state.items), 'Unsupported private state');
    if (command === 'ingest') {
      const draft = validateDraft(await readJson(options.input), today);
      const known = state.items.find((i) => i.id === draft.id);
      check(
        known || state.items.filter((i) => i.status === 'awaiting_review').length < 3,
        'Three drafts are awaiting review; finish those before generating more',
      );
      const digest = contentDigest(draft);
      const folder = path.join(root, 'items', draft.id, digest);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const images = await imageBytes(draft, path.dirname(path.resolve(options.input)));
      await atomic(path.join(folder, 'draft.json'), JSON.stringify(draft, null, 2) + '\n');
      await atomic(path.join(folder, 'review.html'), reviewHtml(draft, images));
      const existing = known;
      const changed = existing?.digest !== digest;
      const item = {
        id: draft.id,
        kind: draft.kind,
        digest,
        folder,
        status: changed ? 'awaiting_review' : existing.status,
        updatedAt: today,
      };
      if (existing) Object.assign(existing, item);
      else state.items.push(item);
    } else if (['stage-approved', 'directory-packet'].includes(command)) {
      check(ID.test(options.id), 'An existing draft ID is required');
      const item = state.items.find((i) => i.id === options.id);
      check(item, 'Draft not found');
      const draft = validateDraft(await readJson(path.join(item.folder, 'draft.json')), today);
      const approval = verifyApproval(draft, await readJson(options.approval), today);
      check(contentDigest(draft) === item.digest, 'Private draft changed unexpectedly');
      if (command === 'stage-approved') {
        check(draft.kind === 'article', 'Article draft required');
        const repo = await realpath(options.repo || ROOT);
        check(
          existsSync(path.join(repo, '.git')) && (await stat(path.join(repo, '.git'))).isFile(),
          'An isolated Git worktree is required',
        );
        const target = path.join(repo, REGISTRY);
        const registry = validateRegistry(await readJson(target), today);
        const legacy = await readFile(
          path.join(repo, 'apps/web/src/features/marketing/learn/blog-content.ts'),
          'utf8',
        );
        check(
          !legacy.includes(`'${draft.article.slug}'`),
          'Slug collides with an existing hand-authored article',
        );
        const existing = registry.articles.find(
          (entry) => entry.article.slug === draft.article.slug,
        );
        check(!existing || existing.draftId === draft.id, 'Slug belongs to another draft');
        const entry = {
          article: draft.article,
          draftId: draft.id,
          contentSha256: item.digest,
          approvedAt: approval.founder.approvedAt,
          contentReviewedAt: approval.content.approvedAt,
        };
        if (existing) Object.assign(existing, entry);
        else registry.articles.push(entry);
        validateRegistry(registry, today);
        await atomic(target, JSON.stringify(registry, null, 2) + '\n');
        item.status = 'staged_for_pr';
        item.stagedAt = today;
      } else {
        check(draft.kind === 'directory', 'Directory draft required');
        const images = await imageBytes(draft, options.assetDir);
        await atomic(path.join(item.folder, 'approved-packet.html'), reviewHtml(draft, images));
        await atomic(
          path.join(item.folder, 'approved-packet.json'),
          JSON.stringify(
            {
              draft,
              contentSha256: item.digest,
              approval,
              status: 'approved_for_named_destination_not_submitted',
            },
            null,
            2,
          ) + '\n',
        );
        item.status = 'approved_for_manual_submission';
      }
      await atomic(
        path.join(item.folder, 'approval.json'),
        JSON.stringify(approval, null, 2) + '\n',
      );
    } else if (command !== 'status')
      throw new Error('Unknown command; no direct publish, send or spend command exists');
    await atomic(stateFile, JSON.stringify(state, null, 2) + '\n');
    return {
      items: state.items.map(({ id, kind, status, folder }) => ({
        id,
        kind,
        status,
        review: path.join(folder, 'review.html'),
      })),
    };
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = {};
    const keys = {
      '--state-dir': 'stateDir',
      '--input': 'input',
      '--id': 'id',
      '--approval': 'approval',
      '--repo': 'repo',
      '--asset-dir': 'assetDir',
    };
    for (let i = 0; i < args.length; i += 2) {
      check(keys[args[i]] && args[i + 1], 'Unknown or incomplete option');
      options[keys[args[i]]] = args[i + 1];
    }
    console.log(JSON.stringify(await execute(command, options), null, 2));
  } catch (error) {
    console.error(
      error.code === 'EEXIST' ? 'Another content run owns the private state lock.' : error.message,
    );
    process.exitCode = 1;
  }
}
