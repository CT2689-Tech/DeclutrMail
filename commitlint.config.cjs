/**
 * commitlint config — Conventional Commits (CLAUDE.md §6).
 *
 * Pattern: `<type>(<scope>): <subject>`
 *
 * The `(D###)` subject trailer and its `d-number-reference` rule were
 * retired 2026-11-17 with the rest of the D-decision system (founder
 * decision). A commit no longer needs a plan number; it needs a type,
 * a scope, and a subject that says what changed.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'security'],
    ],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
