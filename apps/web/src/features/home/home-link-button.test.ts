import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'home-view.module.css');

/**
 * CSS Modules hashes a class inside `:not(.dm-button-link)`, so the rule
 * never excludes the global button and paints its text the same colour
 * as the fill. `:global()` is the exception that must survive that hash.
 */
function compileLikeCssModules(source: string): { css: string; locals: Record<string, string> } {
  const locals: Record<string, string> = {};
  const hash = (name: string) => {
    locals[name] ??= `${name}_hashed`;
    return locals[name];
  };
  const globals: string[] = [];
  const marked = source.replace(/:global\(([^)]+)\)/g, (_, inner: string) => {
    globals.push(inner);
    return `%%G${globals.length - 1}%%`;
  });
  const hashed = marked.replace(/\.([_a-zA-Z][\w-]*)/g, (_, name: string) => `.${hash(name)}`);
  const css = hashed.replace(/%%G(\d+)%%/g, (_, index: string) => globals[Number(index)] ?? '');
  return { css, locals };
}

describe('Home link buttons', () => {
  it('keeps button text a different colour from the button fill', () => {
    const source = readFileSync(cssPath, 'utf8');
    expect(source).toContain(':not(:global(.dm-button-link))');
    expect(source).not.toMatch(/:not\(\.dm-button-link\)/);

    const { css, locals } = compileLikeCssModules(source);
    const style = document.createElement('style');
    style.textContent = `
      :root {
        --dm-primary: rgb(89, 65, 95);
        --dm-fg-inverse: rgb(255, 255, 255);
      }
      .dm-button-link {
        background: var(--dm-primary);
        color: var(--dm-fg-inverse);
      }
      ${css}
    `;
    document.head.appendChild(style);
    const page = document.createElement('div');
    page.className = locals.page ?? '';
    page.innerHTML =
      '<a class="dm-button-link" href="/senders">Review senders</a><a class="plain" href="/activity">See your activity</a>';
    document.body.appendChild(page);

    const button = page.querySelector('.dm-button-link');
    const plain = page.querySelector('.plain');
    if (!(button instanceof HTMLElement) || !(plain instanceof HTMLElement)) {
      throw new Error('fixture links missing');
    }
    const buttonStyle = getComputedStyle(button);
    const plainStyle = getComputedStyle(plain);
    expect(buttonStyle.color).toBe('rgb(255, 255, 255)');
    expect(buttonStyle.backgroundColor).toBe('rgb(89, 65, 95)');
    expect(buttonStyle.color).not.toBe(buttonStyle.backgroundColor);
    expect(plainStyle.color).toBe('rgb(89, 65, 95)');

    style.remove();
    page.remove();
  });

  it('stacks the home report card and does not hide the lead, tile, or trust line', () => {
    const source = readFileSync(cssPath, 'utf8');
    expect(source).not.toContain('[data-preview-report]');
    expect(source).not.toContain('.reportFallback');
    expect(source).not.toMatch(/\.trust\s*\{[^}]*display:\s*none/);
    expect(source).toContain('flex-direction: column');

    const { css, locals } = compileLikeCssModules(source);
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const report = document.createElement('section');
    report.className = locals.report ?? '';
    const slot = document.createElement('div');
    slot.className = locals.reportCard ?? '';
    const link = document.createElement('a');
    link.dataset.mailbox = 'mb-1';
    link.innerHTML =
      '<strong>Your Inbox Report</strong><span>A quick look</span><span>Open report</span>';
    slot.appendChild(link);
    const facts = document.createElement('div');
    facts.className = locals.reportFacts ?? '';
    facts.dataset.reportFacts = '';
    facts.textContent = '91%';
    report.append(slot, facts);
    document.body.appendChild(report);

    expect(getComputedStyle(link).display).toBe('flex');
    expect(getComputedStyle(link).flexDirection).toBe('column');
    expect(getComputedStyle(facts).display).not.toBe('none');

    style.remove();
    report.remove();
  });
});
