## 2026-10-24 — One grammar, two private implementations: the swipe mapping drifted
**Context:** Aligning phone gestures across Triage and Senders for the mobile app.
**Finding:** Triage and Senders each had a private swipe hook with a different mapping (left was Archive on one, expand on the other). Both also showed a hint for a verb a guard could then refuse on release, so the screen promised what a release would not do. The two hooks also differed on whether a control inside the surface keeps its own gesture.
**Rule (provisional):** A grammar that must read the same on two screens lives in one shared hook with one label table, and the hook takes an availability check so the hint and the action cannot disagree. Pin the pure mapping in the shared package and the DOM behaviour where a DOM exists.
**Distillation trigger:** "promote to CLAUDE.md §8 (shared grammar across sibling surfaces) if a third surface drifts from a shared grammar"
