import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

interface Action {
  type:
    | 'radio'
    | 'select'
    | 'checkbox'
    | 'key'
    | 'details'
    | 'confirm'
    | 'button'
    | 'menuitem'
    | 'fill'
    | 'focus';
  name?: string;
  namePattern?: string;
  value?: string;
  key?: string;
  selector?: string;
  role?: 'button' | 'menuitem' | 'radio' | 'checkbox' | 'combobox';
}
interface Scenario {
  id: string;
  title: string;
  group: string;
  surface: string;
  verb: string;
  state: string;
  widths?: number[];
  actions?: Action[];
  [key: string]: unknown;
}
const scenarios = JSON.parse(
  readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'),
) as Scenario[];
if (!scenarios.length || new Set(scenarios.map(({ id }) => id)).size !== scenarios.length)
  throw new Error('Evidence scenarios must have unique IDs and must not be empty');
const source = {
  label: process.env.SOURCE_LABEL ?? 'local-unverified',
  sha: process.env.SOURCE_SHA ?? 'local-unverified',
  harnessSha: process.env.HARNESS_SHA ?? 'local-unverified',
};
const webRoot = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const requireFromShared = createRequire(new URL('../../shared/package.json', import.meta.url));
const esbuild = createRequire(requireFromShared.resolve('vite/package.json'))('esbuild') as {
  build(
    options: Record<string, unknown>,
  ): Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
interface FixtureBuild {
  onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: string; resolveDir: string },
  ): void;
}
// Every snapshot supplies its real components, wrappers, copy and CSS. Only auth,
// telemetry and the framework Link boundary are replaced; callbacks stay synthetic.
const { outputFiles } = await esbuild.build({
  absWorkingDir: webRoot,
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  entryPoints: ['src/test/pr1095-visual-evidence.fixture.tsx'],
  outfile: 'fixture.js',
  write: false,
  plugins: [
    {
      name: 'isolated-evidence-boundaries',
      setup(build: FixtureBuild) {
        build.onResolve({ filter: /(?:auth-provider|posthog|next\/link)$/ }, () => ({
          path: 'mocks',
          namespace: 'evidence',
        }));
        build.onLoad({ filter: /.*/, namespace: 'evidence' }, () => ({
          loader: 'tsx',
          resolveDir: webRoot,
          contents: `export const useOptionalAuth=()=>null; export const getActiveMailboxEmail=()=>null;
          export const track=async()=>undefined; export default function Link(props){return <a {...props}/>}`,
        }));
      },
    },
  ],
});
const client = outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css =
  readFileSync(new URL('../../shared/src/styles/tokens.css', import.meta.url), 'utf8') +
  outputFiles.find((file) => file.path.endsWith('.css'))!.text;
// CSP protects the exported built-in-browser fixture too; no provider/auth requests.
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
if (process.env.DM_EVIDENCE_EXPORT_DIR) {
  const dir = process.env.DM_EVIDENCE_EXPORT_DIR;
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of [
    ['index.html', html],
    ['fixture.js', client],
    ['fixture.css', css],
    ['source.json', JSON.stringify(source, null, 2)],
  ])
    writeFileSync(join(dir, name!), value!);
}
let server: ReturnType<typeof createServer>;
let url: string;
test.use({
  storageState: { cookies: [], origins: [] },
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'America/Los_Angeles',
});
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const asset = req.url === '/fixture.js' ? client : req.url === '/fixture.css' ? css : html;
    const kind =
      req.url === '/fixture.js'
        ? 'text/javascript'
        : req.url === '/fixture.css'
          ? 'text/css'
          : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': kind });
    res.end(asset);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
for (const scenario of scenarios)
  for (const width of scenario.widths ?? [1280]) {
    test(`${scenario.id} · ${width}px · ${scenario.title}`, async ({ page }, info) => {
      await page.setViewportSize({
        width,
        height: width === 320 ? 568 : width === 360 ? 640 : 1000,
      });
      await page.clock.setFixedTime(new Date('2026-10-21T19:00:00.000Z'));
      const dir = process.env.DM_EVIDENCE_OUTPUT_DIR ?? info.project.outputDir;
      mkdirSync(dir, { recursive: true });
      const errors: string[] = [];
      const completed: Array<Action & { outcome?: string }> = [];
      const checkpoints: Awaited<ReturnType<typeof checkpoint>>[] = [];
      const writeManifest = () =>
        writeFileSync(
          join(dir, `manifest-${scenario.id}-${width}.json`),
          JSON.stringify(
            {
              sourceLabel: source.label,
              sourceSha: source.sha,
              harnessSha: source.harnessSha,
              caseId: scenario.id,
              width,
              height: page.viewportSize()!.height,
              scenario,
              checkpoints,
              errors,
            },
            null,
            2,
          ),
        );
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await page.route('**/*', async (route) => {
        const target = new URL(route.request().url());
        if (!['http:', 'https:'].includes(target.protocol) || target.origin === new URL(url).origin)
          await route.continue();
        else {
          errors.push(`Blocked external request: ${target.origin}${target.pathname}`);
          await route.abort('blockedbyclient');
        }
      });
      const capture = async (stage: string, action: Action | null = null, result = stage) => {
        checkpoints.push(
          await checkpoint(page, dir, scenario, width, stage, completed, errors, action, result),
        );
        writeManifest();
      };
      writeManifest();
      try {
        await page.goto(`${url}?case=${encodeURIComponent(scenario.id)}`);
        await page.getByRole('button', { name: 'Open review', exact: true }).click();
        await capture('initial');
        for (const [index, action] of (scenario.actions ?? []).entries()) {
          const stage = `${String(index + 1).padStart(2, '0')}-${action.type}`;
          if (action.type === 'confirm') await capture(`${stage}-before`, action, 'before-confirm');
          if (
            action.type === 'details' &&
            source.label === 'before' &&
            ['unsub-details', 'unsub-details-today', 'unsub-details-yesterday'].includes(
              scenario.id,
            ) &&
            !(await (await scopeFor(page)).getByText('Details', { exact: true }).count())
          ) {
            completed.push({
              ...action,
              outcome: 'Details disclosure absent in the before snapshot (expected UI difference)',
            });
            await capture(`${stage}-absent-in-before`, action, 'expected-absence');
            continue;
          }
          await act(page, action);
          completed.push(action);
          await capture(stage, action, 'completed');
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        try {
          await capture('final');
        } finally {
          writeManifest();
        }
      }
      expect(errors, 'Evidence must retain and report interaction or browser failures').toEqual([]);
    });
  }
async function scopeFor(page: Page): Promise<Locator> {
  const dialogs = page.locator(
    '[role="dialog"]:visible, [role="alertdialog"]:visible, dialog[open]:visible',
  );
  return (await dialogs.count()) ? dialogs.last() : page.locator('body');
}
async function act(page: Page, action: Action): Promise<void> {
  if (action.type === 'key') {
    await page.keyboard.press(action.key ?? action.value ?? 'Tab');
    return;
  }
  const scope = await scopeFor(page);
  const name = action.namePattern ? new RegExp(action.namePattern) : action.name;
  const named = name === undefined ? {} : { name, exact: !action.namePattern };
  const control = (role: NonNullable<Action['role']>) => scope.getByRole(role, named);
  switch (action.type) {
    case 'radio':
      await control('radio').click();
      return;
    case 'select':
      await control('combobox').selectOption(action.value!);
      return;
    case 'checkbox':
      await control('checkbox').setChecked(action.value !== 'false');
      return;
    case 'button':
      await (
        action.role === 'menuitem' ? page.getByRole('menuitem', named) : control('button')
      ).click();
      return;
    case 'menuitem':
      await page.getByRole('menuitem', named).click();
      return;
    case 'fill':
      if (!action.selector) throw new Error('fill requires a selector');
      await scope.locator(action.selector).fill(action.value ?? '');
      return;
    case 'focus':
      await (
        action.selector ? scope.locator(action.selector) : control(action.role ?? 'button')
      ).focus();
      return;
    case 'details':
      await scope.getByText(name ?? 'Details', { exact: !action.namePattern }).click();
      return;
    case 'confirm': {
      if (name !== undefined) {
        await control('button').click();
        return;
      }
      for (const selector of [
        '[data-dm-sheet-primary] button',
        '.dm-confirm-footer button:last-child',
        '.dm-dialog-footer button:last-child',
      ]) {
        const primary = scope.locator(selector).filter({ visible: true });
        if ((await primary.count()) === 1) {
          await primary.click();
          return;
        }
      }
      throw new Error('No unambiguous production primary button; provide confirm.name');
    }
  }
}
async function checkpoint(
  page: Page,
  dir: string,
  scenario: Scenario,
  width: number,
  stage: string,
  actions: Action[],
  errors: string[],
  action: Action | null,
  result: string,
) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const stem = `${scenario.id}-${width}-${stage}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  await page.screenshot({
    path: join(dir, `${stem}.png`),
    animations: 'disabled',
    fullPage: false,
  });
  const state = await page.evaluate(() => {
    const describe = (element: Element) => {
      const field = element as HTMLInputElement;
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        text: element.textContent,
        attributes: Object.fromEntries(
          element.getAttributeNames().map((name) => [name, element.getAttribute(name)]),
        ),
        labels: Array.from(field.labels ?? []).map((label) => label.textContent),
        value: field.value,
        checked: field.checked,
        disabled: field.disabled,
        tabIndex: (element as HTMLElement).tabIndex,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    };
    return {
      text: document.body.innerText,
      controls: Array.from(
        document.querySelectorAll(
          'button,input,select,textarea,a,summary,[role="radio"],[role="checkbox"],[role="menuitem"]',
        ),
      ).map(describe),
      activeElement: document.activeElement ? describe(document.activeElement) : null,
      selectedRadios: Array.from(
        document.querySelectorAll(
          'input[type="radio"]:checked,[role="radio"][aria-checked="true"]',
        ),
      ).map(describe),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
    };
  });
  const record = {
    sourceLabel: source.label,
    sourceSha: source.sha,
    harnessSha: source.harnessSha,
    caseId: scenario.id,
    stage,
    image: `${stem}.png`,
    json: `${stem}.json`,
    textFile: `${stem}.txt`,
    ariaFile: `${stem}.aria.txt`,
    action,
    result,
    actions: [...actions],
    errors: [...errors],
    ...state,
  };
  writeFileSync(join(dir, record.json), JSON.stringify(record, null, 2));
  writeFileSync(join(dir, record.textFile), state.text);
  writeFileSync(join(dir, record.ariaFile), await page.locator('body').ariaSnapshot());
  return record;
}
