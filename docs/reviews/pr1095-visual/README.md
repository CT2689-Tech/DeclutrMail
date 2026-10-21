# PR #1095 visual evidence

This temporary harness captures real production components and their own CSS from three immutable snapshots, using the same synthetic fixture and scenario data in each. It records component rendering and local callback behavior; it does not establish a signed-in production journey, deployment state, or Gmail mutation.

| Label    | Source commit                              |
| -------- | ------------------------------------------ |
| before   | `c1653a29e3e01cb489b68610bb9b2daa48404d04` |
| rejected | `00c2d24215b458c71b3bbf564b82ea88332de76c` |
| after    | `a7464ac4820bd00df215622bb972e7d2ec5120d5` |

The workflow runs only on pushes to `codex/pr1095-visual-evidence`. It checks out the harness and each source separately, installs the source's frozen lockfile, and injects only evidence fixtures/configuration. It uses the existing Playwright render project with a generated exact-file match because the normal render filename pattern excludes digits. No application build, deployment, secret, authenticated account, database, or provider is required. Checkout credentials are not persisted. External browser HTTP requests are aborted; the exported fixture also has a restrictive Content Security Policy.

## Scenarios and captures

`fixture.tsx` and `scenarios.json` are owned by the integration owner. A scenario supplies `id`, `title`, `group`, `surface`, `verb`, `state`, optional fixture data, optional `widths`, and ordered `actions`. Width defaults to 1280px with 1000px height. Phone widths 320px and 360px use heights 568px and 640px.

The runner opens `?case=<id>`, clicks the exact **Open review** button, and saves an initial checkpoint. It then saves a checkpoint after each action, immediately before any confirm action, and at the end. Each checkpoint includes a viewport PNG, body text, an accessibility tree, control attributes and geometry, focused element, selected radios, action history, scenario data, source/harness SHAs, and any errors. Names follow `<case-id>-<width>-<stage>.*`. Disabled controls, missing controls, page errors, and blocked external requests fail the case while retaining evidence. No force clicks, DOM patches, retries, or source changes conceal differences between snapshots.

All cases use `en-US`, `America/Los_Angeles`, reduced motion, and a fixed clock at `2026-10-21T19:00:00Z`. The absent Details disclosure is explicitly captured as an expected difference only for the before snapshot's `unsub-details`, `unsub-details-today`, and `unsub-details-yesterday` cases; rejected/after must expose it.

Actions support `radio`, `select`, `checkbox`, `key`, `details`, `confirm`, `button`, `menuitem`, `fill`, and `focus`. Use exact `name` or optional `namePattern` (a regular expression string). Ordinary controls resolve inside the visible dialog/alertdialog when one exists; menu items resolve on the page. A select with no name requires one unambiguous combobox. Checkbox `value: "false"` unchecks; other values check. Fill requires `selector`; focus accepts a selector or a named button/explicit `role`. Key accepts `key`, including `F8` for fixture count refresh and `Tab` for native focus. Confirm without a name uses an unambiguous production primary-button marker. Supply an explicit name when no such marker exists. All accepted outputs are local synthetic callbacks.

The unconditional seven-day workflow artifact contains all checkpoints, the scenario manifest, source identity, the Playwright report, and retained failure traces. Download it with the normal read-only command:

```sh
gh run download <run-id> --name pr1095-visual-after-a7464ac4820bd00df215622bb972e7d2ec5120d5 --dir /tmp/pr1095-visual-after
```

Captures are flat under `snapshot/visual-evidence/<sourceLabel>/`, selected by `DM_EVIDENCE_OUTPUT_DIR`. Every case/width writes `manifest-<caseId>-<width>.json` with `{sourceLabel, sourceSha, harnessSha, caseId, width, height, scenario, checkpoints, errors}` after every checkpoint. Each checkpoint has `{stage, image, json, textFile, ariaFile, action, result, text, controls, activeElement, selectedRadios, viewport, actions, errors}`. File references are relative to that directory. Results are `initial`, `before-confirm`, `completed`, `expected-absence`, or `final`. A failing case preserves its manifest and all completed captures.

## Export for Codex's built-in browser

Use a disposable checkout of a pinned source. Copy the fixture, scenarios, spec, and generated configuration exactly as the workflow's installation step does. Install that snapshot's frozen dependencies. Collection builds the fixture without launching a browser:

```sh
DM_EVIDENCE_EXPORT_DIR=/tmp/pr1095-visual-after \
SOURCE_LABEL=after SOURCE_SHA=a7464ac4820bd00df215622bb972e7d2ec5120d5 \
E2E_SKIP_STACK_SETUP=1 \
pnpm --filter @declutrmail/e2e exec playwright test \
  --config=pr1095-visual-evidence.config.ts --project=render \
  render-pr1095-visual-evidence.spec.ts --list
python3 -m http.server 4319 --bind 127.0.0.1 --directory /tmp/pr1095-visual-after
```

Open `http://127.0.0.1:4319/?case=<id>` only in Codex's built-in browser. Reuse existing tabs/sessions. A failed built-in-browser navigation remains an unverified browser layer; CI screenshots are separate fixture evidence. Stop the local server after review. Publishing, dispatching, and assembling the final comparison pack belong to the integration owner.
