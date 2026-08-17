import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('reduced-motion CSS contract', () => {
  it('disables continuous loaders and minimizes global motion', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.dm-skeleton,[\s\S]*?\.dm-spinner[\s\S]*?animation: none !important/);
    expect(css).toMatch(/animation-duration: 0\.01ms !important/);
    expect(css).toMatch(/transition-duration: 0\.01ms !important/);
    expect(css).toMatch(/scroll-behavior: auto !important/);
  });
});

describe('avatar tonal theme contract', () => {
  it('defines a complete dimensional range for both light and dark surfaces', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    const light = css.match(/:root,\n\[data-theme='light'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const dark = css.match(/\[data-theme='dark'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';

    for (const block of [light, dark]) {
      expect(block).toMatch(/--dm-avatar-highlight-l:/);
      expect(block).toMatch(/--dm-avatar-bg-l:/);
      expect(block).toMatch(/--dm-avatar-shadow-l:/);
      expect(block).toMatch(/--dm-avatar-fg-l:/);
      expect(block).toMatch(/--dm-avatar-rim-l:/);
      expect(block).toMatch(/--dm-avatar-rim-a:/);
      expect(block).toMatch(/--dm-avatar-shine-l:/);
      expect(block).toMatch(/--dm-avatar-shine-a:/);
      expect(block).toMatch(/--dm-avatar-depth-a:/);
    }
  });

  it('does not expose saturation controls that could reintroduce generated brand colors', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    const light = css.match(/:root,\n\[data-theme='light'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const dark = css.match(/\[data-theme='dark'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(light).not.toMatch(/--dm-avatar-[^:]*-s:/);
    expect(dark).not.toMatch(/--dm-avatar-[^:]*-s:/);
  });
});
