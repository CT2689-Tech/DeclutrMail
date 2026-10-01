# 2026-09-30 — Activity summary exceeded the merge build budget

**Caught by:** CI bundle-budget check on PR #838, then user report.

The local Activity build measured 263.6 kB against a 264 kB first-load limit, while CI's tested merge measured 264.1 kB. A local pass with that little margin was insufficient evidence of readiness.

Moved the desktop filter dialog and mobile filter sheet into a module loaded only when Filter opens. The controls, URL updates, dismissal, and focus restoration remain the same; unit tests and an authenticated browser regression cover both layouts. Removed unused summary-label metadata. The budget stays unchanged.

For future bundle changes, inspect CI's actual merge-build measurement and leave room for shared chunk changes. Confirm queue checks before reporting a merge; a local pass alone does not establish compatibility with current main.
