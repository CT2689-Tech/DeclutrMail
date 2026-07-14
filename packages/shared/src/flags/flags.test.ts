import { describe, expect, it } from 'vitest';

import { FLAG_MANIFEST, FEATURE_FLAGS } from './manifest';
import { flagEnvKey, resolveFlag, resolveAllFlags } from './resolve';

describe('flags manifest', () => {
  it('every flag carries a default and a non-empty description', () => {
    for (const flag of FEATURE_FLAGS) {
      const def = FLAG_MANIFEST[flag];
      expect(typeof def.default).toBe('boolean');
      expect(def.description.length).toBeGreaterThan(20);
    }
  });
});

describe('flagEnvKey', () => {
  it('maps camelCase to DM_FLAG_SNAKE', () => {
    expect(flagEnvKey('darkMode')).toBe('DM_FLAG_DARK_MODE');
    expect(flagEnvKey('senderPeek')).toBe('DM_FLAG_SENDER_PEEK');
    expect(flagEnvKey('gmailDeeplinkSearchFallback')).toBe(
      'DM_FLAG_GMAIL_DEEPLINK_SEARCH_FALLBACK',
    );
  });
});

describe('resolveFlag', () => {
  it('falls back to the manifest default when unset', () => {
    expect(resolveFlag('darkMode', undefined)).toBe(FLAG_MANIFEST.darkMode.default);
  });

  it('honors truthy and falsy override spellings', () => {
    for (const v of ['1', 'true', 'on', 'yes', ' TRUE ']) {
      expect(resolveFlag('darkMode', v)).toBe(true);
    }
    for (const v of ['0', 'false', 'off', 'no', ' False ']) {
      expect(resolveFlag('darkMode', v)).toBe(false);
    }
  });

  it('ignores unrecognized values (typos cannot flip a flag)', () => {
    expect(resolveFlag('darkMode', 'flase')).toBe(FLAG_MANIFEST.darkMode.default);
    expect(resolveFlag('darkMode', '')).toBe(FLAG_MANIFEST.darkMode.default);
  });
});

describe('resolveAllFlags', () => {
  it('resolves the whole manifest with env overrides applied', () => {
    const flags = resolveAllFlags({ DM_FLAG_DARK_MODE: 'off' });
    expect(flags.darkMode).toBe(false);
    expect(flags.senderPeek).toBe(FLAG_MANIFEST.senderPeek.default);
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_FLAGS].sort());
  });
});
