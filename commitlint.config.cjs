/**
 * commitlint config — Conventional Commits + D-number trailer.
 *
 * CLAUDE.md §6 pattern: `<type>(<scope>): <subject> (D<NNN>[, D<NNN>])`
 *
 * The `d-number-reference` rule enforces the trailing `(D###)` reference
 * (or `(D###, D###)` for multi-D commits) for non-bootstrap branches.
 * Bootstrap commits (`chore/bootstrap-*` branches) are exempt because PR 1
 * lays groundwork before D-decisions are assignable.
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
    'd-number-reference': [2, 'always'],
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
          if (/^chore\/bootstrap-/.test(branch)) return [true];
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
