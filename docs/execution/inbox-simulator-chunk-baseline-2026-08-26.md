# Inbox simulator chunk baseline — 2026-08-26

**Purpose.** Reference baseline for the question Plan 4's final task must
re-ask: _is the query layer (TanStack Query, `useMe`, the authenticated API
client) absent from the `/inbox-simulator` route's first-load chunk set?_
Diff a future measurement against this file using the reproduction commands
in the last section.

**Measured at commit:** `81954ac8` (full: `81954ac885ac694ae1832be8e631a7057da43c2e`)
Branch: `feat/d133-inbox-simulator-scale`. Working tree was clean at
measurement time (`git status --short` produced no output).

**Verdict: FAIL.** The query layer is present in the route's chunk set. See
"Step 3" below for the exact module and the mechanism. This is not the
failure mode Task 4 was built to prevent — Task 4's specific fix
(`MailboxActionContext` → `MailboxActionContextView`) holds, verified
independently below — but the broader claim in Task 4's brief ("importing
[`BatchActionSheet`/`ConfirmModalFrame`] as-is drags the query layer into
the public marketing chunk") undersold the problem: the query layer is
already in this route's chunk set today, via a path that has nothing to do
with either component.

---

## Step 1: Build

Command:

```
pnpm --filter @declutrmail/web build
```

Result: **succeeded.** Relevant line from the build's route table (Actual
output, trimmed to the one row that matters):

```
Route (app)                                            Size  First Load JS
├ ○ /inbox-simulator                                9.23 kB         173 kB
├ ○ /inbox-simulator/opengraph-image-ejwaw3           340 B         107 kB
+ First Load JS shared by all                        107 kB
  ├ chunks/3820-c11a79632dd6224d.js                 47.5 kB
  ├ chunks/fd74c2f4-96d974ee2cc492e0.js             54.4 kB
  └ other shared chunks (total)                     4.82 kB
```

`/inbox-simulator` ships 173 kB First Load JS against a 107 kB
shared-by-all baseline — 66 kB of route-specific chunks beyond what every
route pays.

## Step 2: Extract the route's module list

**The brief's literal Python snippet has a bug — do not run it unmodified.**
`app-build-manifest.json` has two keys containing the substring
`inbox-simulator`:

```
/(marketing)/inbox-simulator/opengraph-image-ejwaw3/route
/(marketing)/inbox-simulator/page
```

`next(k for k in m['pages'] if 'inbox-simulator' in k)` returns whichever
of these two keys iterates first — in this build, that was the **OG-image
route**, not the page:

```
Brief's literal next()-first match: /(marketing)/inbox-simulator/opengraph-image-ejwaw3/route
```

That key's file list (5 files: `3820`, `fd74c2f4`, `main-app`, `webpack`,
and the OG-image route file itself) is the app-shell baseline plus one
tiny image-generation module — not informative about the page's own
bundle. The corrected filter adds `and k.endswith('/page')`, matching the
brief's own worked example (`/(marketing)/inbox-simulator/page`).

**Corrected route key:** `/(marketing)/inbox-simulator/page`

**Complete file list (15 files):**

```
static/chunks/1238-64c2e291655ced8d.js
static/chunks/1866-2f573f5aa616fa60.js
static/chunks/2907-d5fe5d3918b50755.js
static/chunks/3820-c11a79632dd6224d.js
static/chunks/5258-df3ea423d857594d.js
static/chunks/5793-1b57f7a60d6cf7b6.js
static/chunks/5949-d8183605ff0dc978.js
static/chunks/6218-36167fb641d5c86f.js
static/chunks/6410-b757902d01522918.js
static/chunks/8261-edbb440e18588b22.js
static/chunks/app/(marketing)/inbox-simulator/page-e680ead8cf670dff.js
static/chunks/fd74c2f4-96d974ee2cc492e0.js
static/chunks/main-app-36c933cd262664fa.js
static/chunks/webpack-bb71c40ad6608e41.js
static/css/d3c51ebaef36a7dd.css
```

(14 JS files + 1 CSS file. File count observed directly from
`len(files)` — not estimated.)

## Step 3: Is the query layer absent? No — and the brief's literal check can't tell you that

### 3a. The brief's literal command, run as written

```
grep -l "react-query\|useMe" apps/web/.next/static/chunks/*.js 2>/dev/null
```

Actual output (7 files):

```
apps/web/.next/static/chunks/2510-9871f7be90b9c84d.js
apps/web/.next/static/chunks/2925-93b988feb9267a29.js
apps/web/.next/static/chunks/3820-c11a79632dd6224d.js
apps/web/.next/static/chunks/4438-588dd81d90a0fc04.js
apps/web/.next/static/chunks/framework-129526e960182d2e.js
apps/web/.next/static/chunks/fd74c2f4-96d974ee2cc492e0.js
apps/web/.next/static/chunks/main-9ddf7a056bc7f259.js
```

**None of these 7 are a real hit, and the real hit (below) is not among
them.** Verified by extracting match context (`grep -oE ".{20}useMe.{20}"`)
for every one of the 7 files:

- Every "useMe" match is `useMemo` or `useMemoCache` (React's own
  built-in hook, present in nearly every bundle that uses React) or
  `useMergedRef` (a Next.js/React-DOM internal). Zero occurrences of the
  app's own `useMe` hook as an identifier in any of these 7 files.
- The literal string `react-query` occurs **zero times** in any of the 7
  files, and — checked separately — zero times in **any** chunk in the
  entire build (`grep -rl "react-query" apps/web/.next/static/` returns
  nothing at all). The npm package name is never emitted into compiled
  output; it exists in `package.json` and source comments, both stripped
  before this point. Half of the brief's pattern is unable to ever match
  anything, in any build.
- Cross-referencing these 7 files against the Step 2 list: only `3820`
  and `fd74c2f4` appear in the `/inbox-simulator/page` file list, and
  both are the universal shared-by-all chunks (confirmed above) — pure
  `useMemo`/`useMemoCache` framework noise, not app code. Per the task's
  own criterion this would be reported "fine," and that conclusion is
  correct here, but only because I opened every match and read it. The
  literal command, taken at face value, does not distinguish this from
  the real failure below — it doesn't even surface the real failure.

**The brief's Step 3 command, run as specified and trusted at face value,
would have produced a false PASS.**

### 3b. Corrected check: search for the `useMe` module's actual runtime signature

Minification renames the `useMe` function itself (it compiles to a
single-letter local binding), so the identifier `useMe` does not survive
in the chunk that contains its real code. What does survive minification
is `useMe`'s literal runtime string data: the fetch URL, the query key,
and the timezone-patch endpoint, all read directly from
`apps/web/src/features/auth/api/use-me.ts`:

```
grep -rl "/api/auth/me" apps/web/.next/static/chunks/
grep -rl '\["auth","me"\]\|"auth","me"' apps/web/.next/static/chunks/
grep -rl "/api/me/timezone" apps/web/.next/static/chunks/
```

Actual output — **all three searches hit exactly one file**,
recursively, across the entire `.next/static/chunks/` tree (not just the
flat top-level glob the brief's command used):

```
apps/web/.next/static/chunks/5793-1b57f7a60d6cf7b6.js
```

(The `/api/auth/me` search also matched two unrelated files —
`chunks/app/not-found-adb673bc01c5a9e4.js` and
`chunks/app/(marketing)/pricing/page-051daef83dbfbd95.js` — both outside
the `/inbox-simulator` list, so not part of this route's chunk set and
not investigated further.)

Match context confirming this is genuinely the compiled
`meQueryOptions()` / `useMe()` / `useUserTimeZone()` code from
`use-me.ts` (not a coincidental string collision):

```
let i=["auth","me"], ...
function l(){return{queryKey:i,queryFn:async e=>{let{signal:r}=e;
  return(await (0,o.Vg)("/api/auth/me",{signal:r})).data},
  retry:(e,r)=>(!(r instanceof o.hD)||401!==r.status)&&e<2,
  staleTime:6e4,refetchOnWindowFocus:!0}}
...
(0,o.$Y)("/api/me/timezone",{timezone:t})
```

This matches `use-me.ts` line for line: `ME_QUERY_KEY = ['auth', 'me']`,
the `queryFn` calling `apiGet('/api/auth/me', { signal })`, the retry
policy checking `ApiError`/401, `staleTime: 60_000`,
`refetchOnWindowFocus: true`, and the `apiPatch('/api/me/timezone', ...)`
call from the timezone-healing effect. `o` is the minified alias for
`apps/web/src/lib/api/client.ts` (also present, in full, in the same
chunk — `ApiError`, CSRF header injection, 401 →
`/api/auth/google/start` redirect, the `apiGet`/`apiPost`/`apiPatch`/
`apiPut`/`apiDelete` functions). Chunk size, measured directly:

```
$ wc -c apps/web/.next/static/chunks/5793-1b57f7a60d6cf7b6.js
    7714 apps/web/.next/static/chunks/5793-1b57f7a60d6cf7b6.js
```

**`static/chunks/5793-1b57f7a60d6cf7b6.js` is in the Step 2 file list for
`/(marketing)/inbox-simulator/page`.** Per the task's own criterion — "a
match inside a chunk that IS in the list is the failure case" — this is
the failure case.

### 3c. What Task 4 specifically fixed does hold

Separately checked all 15 files in the `/inbox-simulator/page` list (14
JS + 1 CSS — the CSS file trivially contributes a zero) for
`auth-provider.tsx`'s own code (the Context/Provider, not just `useMe`)
and for the rendered "Gmail account" note markup that
`MailboxActionContext` produces. Fully runnable form (see "Reproduction
commands" below for how `/tmp/inbox-simulator-chunk-list.txt` is
produced):

```
while IFS= read -r f; do
  c=$(grep -c "AuthProvider\|getActiveMailboxEmail\|useOptionalAuth\|Gmail account:" "$f" 2>/dev/null)
  echo "$c  $f"
done < /tmp/inbox-simulator-chunk-list.txt
```

Actual output: `0` for all 15 lines, one per file — every count reads
`0  apps/web/.next/<path>`. `MailboxActionContext` (the auth-reading
wrapper), `useOptionalAuth`, and `getActiveMailboxEmail` are genuinely
absent from this route's bundle. Task 4's split is not the source of the
Step 3b failure — the `use-me.ts` + API-client leak reaches this route by
a different path.

### 3d. Blast radius — is this a marketing-wide pattern or specific to this route?

```python
routes_with = [k for k, files in m['pages'].items()
               if "static/chunks/5793-1b57f7a60d6cf7b6.js" in files]
```

Actual output: **17 of 83 total routes** include this chunk. Breakdown by
route-group prefix (computed, not eyeballed): **15** are `/(app)/*`
authenticated routes, **1** is `/onboarding/page`, **1** is
`/(marketing)/inbox-simulator/page`. The 16 non-marketing routes are all
genuine `useMe` consumers. Exactly **one** is a public route:
`/(marketing)/inbox-simulator/page`. No other marketing page (`/`,
`/pricing`, `/faq`, etc.) carries this chunk, which rules out "this is
just how the marketing shell always works" — the `(marketing)/layout.tsx`
comment says the root layout supplies a shared `QueryClient` to every
route, but that is the generic provider, not this route pulling in the
concrete `useMe` module and the API client.

### 3e. Why: no source-level import edge, so this is a chunk-splitting effect, not an import leak

Grepped every `.tsx`/`.ts` file under `apps/web/src` for a value-import
of `api/use-me` or `auth-provider`, excluding test files, and checked
each result against `inbox-simulator-screen.tsx`'s own import graph
(`triage/action-preview-presentation`, `triage/triage-row`,
`triage/data`, `triage/types`, `marketing/landing/tracked-cta`,
`marketing/landing/urls`, `@declutrmail/shared/actions`, `lib/posthog`).
Exact command and count:

```
$ grep -rlnE "from '.*api/use-me'|from \"@/features/auth/api/use-me\"|from '@/features/auth/auth-provider'|from '\.\./auth-provider'|from '\./auth-provider'" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "\.test\." | sort -u | wc -l
      45
```

**45 files** (this includes Storybook `.stories.tsx` files, which are
never bundled into a Next.js page chunk and so are irrelevant to
reachability from a page — included anyway because excluding them isn't
needed to reach the right answer, and a broader check is a stronger one).
Printed the full 45-file list and grepped it for any path under
`marketing/inbox-simulator`, `triage/action-preview-presentation.tsx`,
`triage/triage-row.tsx`, `triage/data.ts`, `triage/types.ts`,
`marketing/landing/{tracked-cta,urls}.ts(x)`, or `lib/posthog.ts` — zero
matches. **No source file under `inbox-simulator` imports the query
layer, directly or transitively.**

The leak is webpack's automatic shared-chunk splitting: `use-me.ts` and
`lib/api/client.ts` are small modules used by many `(app)` routes, and
webpack's default chunk-grouping bin-packed them into the same physical
chunk file as `packages/shared`'s `tokens` and `Button` — modules
`/inbox-simulator` genuinely does need (via `ActionPreviewPresentation`
and `TriageRow`). Because `/inbox-simulator` needs two of the four
modules in chunk `5793`, it downloads the other two as a byte-for-byte
side effect, with zero import edge from any inbox-simulator source file
to `auth-provider` or `use-me`. Task 4's fix (severing the
`MailboxActionContext` → `auth-provider` edge from `BatchActionSheet` /
`ConfirmModalFrame`) addresses import-graph leaks; it does not and
structurally cannot address this chunk-grouping leak, because there is
no import edge here to sever.

---

## Verdict

**FAIL** — the query layer (`useMe`, `meQueryOptions`, `ME_QUERY_KEY`,
and the full authenticated API client from `lib/api/client.ts`, including
its 401 → Google-OAuth-redirect logic) is present in chunk
`5793-1b57f7a60d6cf7b6.js`, which is a member of the
`/(marketing)/inbox-simulator/page` file list in
`apps/web/.next/app-build-manifest.json` at commit `81954ac8`.

This is scoped narrowly: `MailboxActionContext`/`auth-provider`'s own
Context-and-Provider code is confirmed absent (§3c) — Task 4's fix holds.
The leak is `use-me.ts` + `lib/api/client.ts` riding into this route's
chunk set via webpack's shared-chunk grouping (§3e), unrelated to
`BatchActionSheet` or `ConfirmModalFrame`, neither of which is rendered
on this route yet (that's Plan 4's job). Fixing this is out of scope for
this task per its own instructions ("If the measurement reveals a
problem, report it — do not fix it") and is not attempted here.

---

## Reproduction commands

Run from the repo root, in order, to re-measure and diff against this
baseline:

```bash
# 1. Build
pnpm --filter @declutrmail/web build

# 2. Find the page route's key and file list (corrected for the
#    two-key ambiguity — do not use the brief's literal next()-only form).
#    Also writes the full paths to a plain file so step 5 can loop over
#    them without hand-expanding anything.
python3 - <<'PY'
import json, pathlib
m = json.loads(pathlib.Path('apps/web/.next/app-build-manifest.json').read_text())
key = next(k for k in m['pages'] if 'inbox-simulator' in k and k.endswith('/page'))
files = m['pages'][key]
print(key)
with open('/tmp/inbox-simulator-chunk-list.txt', 'w') as out:
    for f in sorted(files):
        print(' ', f)
        out.write(f'apps/web/.next/{f}\n')
PY

# 3. Precise query-layer check (recursive, not just the top-level glob;
#    checks the runtime string literals that survive minification,
#    not the "useMe" identifier, which does not)
grep -rl "/api/auth/me" apps/web/.next/static/chunks/
grep -rl "/api/me/timezone" apps/web/.next/static/chunks/

# 4. Confirm any hit's chunk is (or isn't) in the Step 2 file list.
#    A hit in a chunk NOT in the list is the app shell (fine).
#    A hit in a chunk that IS in the list is the failure case.

# 5. Independently confirm auth-provider's own code (not just useMe)
#    stays absent from every file in the route's own chunk set.
#    Fully runnable — no manual expansion needed:
while IFS= read -r f; do
  c=$(grep -c "AuthProvider\|getActiveMailboxEmail\|useOptionalAuth\|Gmail account:" "$f" 2>/dev/null)
  echo "$c  $f"
done < /tmp/inbox-simulator-chunk-list.txt

# 6. Blast-radius check — how many routes share the flagged chunk:
python3 - <<'PY'
import json, pathlib
m = json.loads(pathlib.Path('apps/web/.next/app-build-manifest.json').read_text())
target = "static/chunks/5793-1b57f7a60d6cf7b6.js"  # re-derive this filename each run — content hash changes
routes_with = [k for k, files in m['pages'].items() if target in files]
print(f"{len(routes_with)} of {len(m['pages'])} routes")
for r in sorted(routes_with):
    print(' ', r)
PY
```

Note: chunk filenames are content-hashed and will change between builds
(e.g. `5793-1b57f7a60d6cf7b6.js` is specific to this commit's build
output). Re-derive the target filename each time via the `/api/auth/me`
search in step 3 rather than hard-coding this baseline's hash.
