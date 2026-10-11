import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { glossaryHits, loadUiGlossary, type UiGlossary } from './ui-glossary';

interface TsNode {
  text?: string;
  getStart(source: TsFile): number;
}
interface TsFile {
  getLineAndCharacterOfPosition(pos: number): { line: number };
}
interface TsApi {
  ScriptKind: { TS: number; TSX: number };
  ScriptTarget: { Latest: number };
  createSourceFile(
    fileName: string,
    source: string,
    target: number,
    setParentNodes: boolean,
    scriptKind: number,
  ): TsFile;
  isStringLiteral(node: TsNode): boolean;
  isNoSubstitutionTemplateLiteral(node: TsNode): boolean;
  forEachChild(node: TsNode, visit: (child: TsNode) => void): void;
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const ts = require(join(REPO, 'node_modules/typescript/lib/typescript.js')) as TsApi;
const ROOTS = ['apps/web/src', 'packages/shared/src'];
const SKIP_DIR = new Set(['marketing', 'node_modules', 'design-prototype']);
const SKIP_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

export interface BaselineEntry {
  file: string;
  line: number;
  id: string;
  text: string;
}

export function scanGlossaryHits(glossary: UiGlossary = loadUiGlossary()): BaselineEntry[] {
  const hits: BaselineEntry[] = [];
  for (const root of ROOTS) {
    walk(join(REPO, root), glossary, hits);
  }
  hits.sort((a, b) =>
    `${a.file}:${a.line}:${a.id}:${a.text}`.localeCompare(`${b.file}:${b.line}:${b.id}:${b.text}`),
  );
  return hits;
}

function walk(dir: string, glossary: UiGlossary, hits: BaselineEntry[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, glossary, hits);
      continue;
    }
    if (!/\.[cm]?tsx?$/.test(name) || SKIP_FILE.test(name)) continue;
    if (name === 'ui-glossary.ts' || name === 'ui-glossary-scan.ts') continue;
    collect(path, glossary, hits);
  }
}

function collect(path: string, glossary: UiGlossary, hits: BaselineEntry[]) {
  const source = readFileSync(path, 'utf8');
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind) as TsFile &
    TsNode;
  const scope =
    path.includes('/inbox-report/') || path.includes('/features/report/') ? 'report' : 'all';
  const visit = (node: TsNode) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      for (const hit of glossaryHits(text, glossary, scope)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        hits.push({
          file: relative(REPO, path),
          line,
          id: hit.id,
          text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

export function baselineKey(entry: BaselineEntry): string {
  return `${entry.file}:${entry.id}:${entry.text}`;
}
