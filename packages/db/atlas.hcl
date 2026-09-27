// Atlas config (D152) — Drizzle Kit generates migrations; Atlas lints them.
//
// CI (.github/workflows/migration-lint.yml) loads this file with
// `--config file://packages/db/atlas.hcl` and passes its own `--dev-url`
// (a service-container Postgres). The flag matters: `migrate lint` reads no
// config file unless `--config` or `--env` is given, whatever the working
// directory, and on its built-in defaults `data_depend` is only a warning.
// Keep `lint` at the top level too: CI passes no `--env`, so a block moved
// inside an `env` would be ignored. The workflow lints a known-bad probe and
// fails if either of these stops holding.
//
// Run locally from the repo root with the binary CI uses. Since v0.38 the
// default Atlas build runs `migrate lint` only for paid Atlas Pro users
// (https://atlasgo.io/blog-v038#change-in-v038-atlas-migrate-lint):
//
//   ./scripts/install-atlas.sh "$HOME/.local/bin"
//   "$HOME/.local/bin/atlas" migrate lint \
//     --config 'file://packages/db/atlas.hcl' \
//     --dir 'file://packages/db/migrations' \
//     --dev-url 'docker://postgres/16/dev' --latest 1

lint {
  // Detect dangerous changes per CLAUDE.md §2 + D152.
  destructive {
    error = true
  }
  data_depend {
    error = true
  }
  // Checked on the community build CI installs (negative controls,
  // 2026-09-26), two analyzers never fire there, so neither has a block:
  //   * `incompatible` (BC101/BC102) needs rename detection, which the
  //     community build lacks. A rename still fails, as a drop plus an add:
  //     DS102 for a table, DS103 + MF103 for a column. To accept one, put
  //     an `atlas:nolint` line naming those analyzers above the statement;
  //     `atlas:nolint incompatible` does not suppress them.
  //   * `concurrent_index` is Atlas Pro only
  //     (https://atlasgo.io/lint/analyzers). The `atlas:nolint
  //     concurrent_index` lines in older migrations never took effect, and
  //     lint does not catch a CREATE INDEX without CONCURRENTLY.
}
