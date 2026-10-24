## 2026-10-24 — A `contains` check can be satisfied by the wrong element
**Context:** Pinning that iOS `Info.plist` registers the sign-in return scheme, in `apps/mobile/native-identity.test.ts`.
**Finding:** The first version asserted the `CFBundleURLTypes` block contained `<string>com.declutrmail.app</string>`. The block also holds `CFBundleURLName`, which is set to the same value, so corrupting the scheme itself left the test green. Mutating the file one character and re-running found it; reading the test did not.
**Rule (provisional):** when a test pins a value that appears in more than one role (name and scheme, id and namespace), read the element that plays the role being pinned, then corrupt each role separately and watch that test go red.
**Distillation trigger:** promote to CLAUDE.md §8 if pattern recurs >=3 times
