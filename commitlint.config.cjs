/**
 * commitlint config — Conventional Commits + D-number trailer.
 *
 * CLAUDE.md §6 pattern: `<type>(<scope>): <subject> (D<NNN>[, D<NNN>])`
 *
 * The `d-number-reference` rule checks for the trailing `(D###)` reference
 * (or `(D###, D###)` for multi-D commits). Bootstrap (`chore/bootstrap-*`)
 * and distill (`chore/distill-*`, CLAUDE.md §11) branches were always
 * exempt outright — PR 1 predates D-decisions, and distill commits promote
 * learnings/mistakes without shipping one.
 *
 * Severity dropped from error to WARN 2026-08-28 (founder decision, live
 * during a production-incident fix with no D-decision behind it): not
 * every commit is D-tracked work, and blocking on a trailer that doesn't
 * exist for legitimate ad-hoc fixes was pure friction. The convention
 * still applies and still gets checked — D-tracked work should still
 * carry its trailer — it just no longer blocks the commit when there
 * genuinely isn't one.
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
    'd-number-reference': [1, 'always'],
  },
  plugins: [
    {
      rules: {
        'd-number-reference': (parsed) => {
          const { execSync } = require('node:child_process');
          let branch = '';
          try {
            branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
          } catch {
            return [true];
          }
          if (/^chore\/(bootstrap|distill)-/.test(branch)) return [true];
          const header = parsed.header || '';
          const ok = /\(D\d{1,3}(,\s*D\d{1,3})*\)\s*$/.test(header);
          return [
            ok,
            'commit subject must end with `(D<NNN>)` or `(D<NNN>, D<NNN>)` — see CLAUDE.md §6',
          ];
        },
      },
    },
  ],
};
