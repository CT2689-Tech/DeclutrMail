## 2026-09-26 — A warm `next dev` cache reports a new barrel export as missing

**Context:** D245 added value exports to `@declutrmail/shared/contracts` (listed in `optimizePackageImports`). A dev server started before the edit warned "LABEL_SENDER_PROTECTED_ERROR_CODE is not exported", and the import read as `undefined`.
**Finding:** Only the warm dev cache. With `.next` moved aside the same code compiled clean, and a cold production build (CI env) logged zero "is not exported" lines. No shared barrel uses `export *`, so any new value export edits the barrel file itself, and a fresh-clone build (CI, Vercel restoring `.next/cache`) sees changed content.
**Rule (provisional):** Before debugging a barrel "not exported" warning as a code bug, restart `next dev` with `.next` moved aside. Keep shared barrels on named re-exports: an `export *` would hide a leaf change from the barrel's cache key.
**Distillation trigger:** promote to CLAUDE.md §8's traps list if it recurs.
