// Atlas config (D152) — Drizzle Kit generates migrations; Atlas lints them.
//
// Run locally: `atlas migrate lint --env local --dev-url 'docker://postgres/16/dev'`
// Run in CI:   .github/workflows/migration-lint.yml — passes its own
//              `--dev-url postgres://...` pointing at a service container.
//
// `dev-url` is intentionally NOT hard-coded here. CI uses a service-container
// Postgres; local dev typically uses `docker://postgres/16/dev`. Pass it on
// the command line so the lint rules below stay shared across environments.

env "local" {
  src = "file://packages/db/migrations"

  migration {
    dir = "file://packages/db/migrations"
    format = "golang-migrate"
  }
}

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
  concurrent_index {
    error = true
  }
}
