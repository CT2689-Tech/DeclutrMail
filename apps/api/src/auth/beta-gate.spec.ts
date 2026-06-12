import { afterEach, describe, expect, it } from 'vitest';

import { betaGateAllowsSignup } from './beta-gate.js';

/**
 * Private-beta invite gate (buildout F7) — env-driven allow/deny for
 * brand-new signups. The default posture is the load-bearing case:
 * with BETA_GATE_ENABLED unset (every env today), the gate MUST be a
 * no-op so shipping this code changes nothing until the founder flips
 * the flag.
 */
describe('betaGateAllowsSignup', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  describe('gate disabled (default)', () => {
    it('allows everyone when BETA_GATE_ENABLED is unset', () => {
      delete process.env.BETA_GATE_ENABLED;
      delete process.env.BETA_INVITE_EMAILS;
      expect(betaGateAllowsSignup('anyone@example.com')).toBe(true);
    });

    it.each(['false', '1', 'TRUE', 'yes', ''])(
      'treats BETA_GATE_ENABLED=%j as disabled (only exactly "true" enables)',
      (value) => {
        process.env.BETA_GATE_ENABLED = value;
        process.env.BETA_INVITE_EMAILS = '';
        expect(betaGateAllowsSignup('anyone@example.com')).toBe(true);
      },
    );
  });

  describe('gate enabled', () => {
    it('denies an email not on the invite list', () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = 'invited@example.com';
      expect(betaGateAllowsSignup('stranger@example.com')).toBe(false);
    });

    it('allows an invited email', () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = 'invited@example.com,second@example.com';
      expect(betaGateAllowsSignup('second@example.com')).toBe(true);
    });

    it('matches case-insensitively on both sides', () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = 'Invited@Example.COM';
      expect(betaGateAllowsSignup('invited@example.com')).toBe(true);
      expect(betaGateAllowsSignup('INVITED@EXAMPLE.com')).toBe(true);
    });

    it('trims whitespace around list entries and the candidate', () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = '  invited@example.com , second@example.com ';
      expect(betaGateAllowsSignup(' invited@example.com ')).toBe(true);
      expect(betaGateAllowsSignup('second@example.com')).toBe(true);
    });

    it('ignores empty entries from trailing/double commas (no empty-string match)', () => {
      process.env.BETA_GATE_ENABLED = 'true';
      process.env.BETA_INVITE_EMAILS = 'invited@example.com,, ,';
      // An empty/whitespace candidate must NOT sneak through via a
      // degenerate '' === '' comparison.
      expect(betaGateAllowsSignup('')).toBe(false);
      expect(betaGateAllowsSignup('   ')).toBe(false);
      expect(betaGateAllowsSignup('invited@example.com')).toBe(true);
    });

    it('denies everyone when the list is unset (fail-closed)', () => {
      process.env.BETA_GATE_ENABLED = 'true';
      delete process.env.BETA_INVITE_EMAILS;
      expect(betaGateAllowsSignup('anyone@example.com')).toBe(false);
    });
  });
});
