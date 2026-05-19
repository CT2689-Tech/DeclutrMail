// Atlas config (D152) — Drizzle Kit generates migrations; Atlas lints them.
//
// Run locally: `atlas migrate lint --dir file://packages/db/migrations --dev-url 'docker://postgres/16/dev'`
// Run in CI:   .github/workflows/migration-lint.yml
//
// The `dev-url` is a transient Postgres that Atlas uses to evaluate each
// migration's effect (locking, online-safety, destructive changes).
// No production credentials are referenced here.

env "local" {
  src = "file://packages/db/migrations"
  dev = "docker://postgres/16/dev"

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
