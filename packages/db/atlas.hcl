// Atlas config (D152) — Drizzle Kit generates migrations; Atlas lints them.
//
// CI (.github/workflows/migration-lint.yml) loads this file with
// `--config file://packages/db/atlas.hcl` and passes its own `--dev-url`
// (a service-container Postgres). The flag matters: run from the repo
// root, Atlas looks only for ./atlas.hcl and, finding none, silently lints
// on its defaults.
//
// Run locally from the repo root with the binary CI uses (the default
// Atlas build refuses `migrate lint` without an Atlas Cloud login):
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
  incompatible {
    error = true
  }
  // No `concurrent_index` block: that analyzer is Atlas Pro only
  // (https://atlasgo.io/lint/analyzers), so neither the community build CI
  // installs nor a logged-out default build runs it. The block that sat
  // here, like every `atlas:nolint concurrent_index` directive in the
  // migrations, never took effect: lint does not catch a CREATE INDEX
  // without CONCURRENTLY (negative control, 2026-09-26).
}
