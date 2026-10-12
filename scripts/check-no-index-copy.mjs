#!/usr/bin/env node
// Fails if user-facing copy under apps/web/src says index / indexed / indexing.
// Scans string literals, template text and JSX text via the TypeScript AST.
// Usage (repo root): node scripts/check-no-index-copy.mjs [root=apps/web/src]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const ts = createRequire(join(process.cwd(), 'package.json'))('typescript');

const ROOTS = process.argv.length > 2 ? process.argv.slice(2) : ['apps/web/src'];
const WORD = /\bindex(ed|ing)?\b/i;
// Allowlist: files
const SKIP_FILE = /(\.test\.|\.spec\.|\.stories\.|\.fixture\.|__tests__|__mocks__|\/robots\.ts$|\.d\.ts$)/;
// Allowlist: string values that are not copy
const SKIP_VALUE = [
  /\bnoindex\b|\bnofollow\b/i,          // robots meta
  /^[\w.\-/@:]*$/,                      // single token: identifiers, enum values ('indexed'), paths, kebab ids
  /^(\.{0,2}\/|@\/|https?:)/,           // imports / URLs / routes
];
// Allowlist: JSX attributes / object keys whose value is never shown
const SKIP_ATTR = new Set(['className', 'key', 'id', 'href', 'src', 'data-testid', 'htmlFor', 'rel', 'robots', 'type']);

const hits = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); continue; }
    if (!/\.(tsx?|mts)$/.test(f) || SKIP_FILE.test(p)) continue;
    scan(p);
  }
}
function attrName(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (ts.isJsxAttribute(parent)) return parent.name.getText();
  if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) return parent.parent.name.getText();
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return parent.name.getText();
  return null;
}
function scan(file) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isCallExpression(node) && /^(require|import)$/.test(node.expression.getText())) return;
    let text = null;
    let literal = false;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { text = node.text; literal = true; }
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.getText();
    if (text !== null && WORD.test(text)) {
      const t = text.trim();
      const attr = attrName(node);
      const isCaseLabel = ts.isCaseClause(node.parent) || (ts.isBinaryExpression(node.parent) && /^(===|!==|==|!=)$/.test(node.parent.operatorToken.getText()));
      if (!(attr && SKIP_ATTR.has(attr)) && !isCaseLabel && !SKIP_VALUE.some((r, i) => (i === 1 ? literal : true) && r.test(t))) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        hits.push(`${relative(process.cwd(), file)}:${line + 1}: ${t.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
for (const r of ROOTS) walk(r);
if (hits.length) {
  console.error(`✗ ${hits.length} user-facing string(s) say "index/indexed/indexing". Use the deck wording (scanned, found so far, saved email details):`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('✓ no "index/indexed/indexing" in user-facing copy under ' + ROOTS.join(', '));
