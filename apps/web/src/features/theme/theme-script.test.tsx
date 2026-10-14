import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeScript } from './theme-script';
import { THEME_INIT_SOURCE } from './theme-init-source';

vi.mock('@/lib/flags', () => ({ isFeatureEnabled: () => true }));
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});
const external = readFileSync('public/theme-init.js', 'utf8');

// Execute both pre-paint resolvers against the same browser state.
for (const [name, source] of [
  ['inline', THEME_INIT_SOURCE],
  ['external', external],
]) {
  describe(`${name} theme initialization`, () => {
    it.each(['light', 'dark'])('honors stored %s before rendering', (theme) => {
      localStorage.setItem('dm-theme', theme);
      new Function(source!)();
      expect(document.documentElement.getAttribute('data-theme')).toBe(theme);
    });
    it('uses the OS preference for an invalid stored value', () => {
      localStorage.setItem('dm-theme', 'junk');
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
      new Function(source!)();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    it('falls back to light when storage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      new Function(source!)();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
}
describe('theme script placement', () => {
  it('inlines the public resolver without a network request', () => {
    const { container } = render(<ThemeScript inline />);
    expect(container.querySelector('script')?.hasAttribute('src')).toBe(false);
    expect(container.querySelector('script')?.textContent).toBe(THEME_INIT_SOURCE);
  });
  it('preserves the nonced external resolver for authenticated layouts', () => {
    const { container } = render(<ThemeScript nonce="request-nonce" />);
    expect(container.querySelector('script')?.getAttribute('src')).toBe('/theme-init.js');
    expect(container.querySelector('script')?.getAttribute('nonce')).toBe('request-nonce');
  });
});
