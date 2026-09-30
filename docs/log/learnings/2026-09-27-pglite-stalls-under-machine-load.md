## 2026-09-27 — PGlite test runs stall indefinitely when the machine is overloaded
**Context:** Running worker/api vitest suites for #791 while many parallel sessions ran their own suites (load average 60–230 on an 8-core machine).
**Finding:** Runs that finish in seconds at load 2–9 sat for an hour with no output. `sample` on a fork showed the main thread in a tight loop of `Runtime_ThrowWasmError` → `CaptureAndSetErrorStack` inside PGlite, called from a microtask — it never yielded, so vitest's 30s timeouts never fired. Killing and re-running at low load passed every time.
**Rule (provisional):** Check `sysctl -n vm.loadavg` before a PGlite suite; above ~24 (1-minute), wait. A silent vitest run past a few minutes is this stall, not a hung test — sample it (`sample <pid> 2`) before debugging product code.
**Distillation trigger:** promote to CLAUDE.md §8 "Known false-positive/negative traps" if it recurs ≥3 times.
