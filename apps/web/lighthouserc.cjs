// Lighthouse CI for the public marketing pages (D160).
//
// D160 specified "Lighthouse score on marketing pages (≥90)" and the
// gate was never built, so the number the plan sets as the target had
// never once been measured. This file measures it.
//
// AGAINST THE BUILT APP, NEVER `next dev`. A dev-server score is
// meaningless — unminified bundles, no static HTML, React in dev mode,
// on-demand compilation in the critical path. `startServerCommand` runs
// `next start`, which serves the same prerendered HTML production does.
//
// THE URL SET is deliberately mixed, because the two shapes now perform
// differently (#525):
//   /                        dynamic — reads edge geo for the D117 rail
//   /pricing                 dynamic — same, and the page that converts
//   /security                static  — prerendered, CDN-cacheable
//   /how-to/clean-gmail...   static  — the long-tail SEO shape, the bulk
//                                      of what search traffic lands on
// Scoring only the static pages would flatter the result; scoring only
// the dynamic ones would hide the win.
//
// THRESHOLDS ARE MEASURED, NOT ASPIRATIONAL. Performance is pinned at
// D160's 0.90. The other three categories are set to what this build
// actually scores, as a RATCHET — they exist to catch a regression, not
// to assert a target nobody has hit. Raise them when the real number
// rises; never lower one to make a red build green.

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'pnpm exec next start -p 4173',
      // Next prints "✓ Ready in 123ms" once the server is accepting.
      startServerReadyPattern: 'Ready in',
      startServerReadyTimeout: 60000,
      url: [
        'http://localhost:4173/',
        'http://localhost:4173/pricing',
        'http://localhost:4173/security',
        'http://localhost:4173/how-to/clean-gmail-by-sender',
      ],
      // Three runs, median reported. A single run on a shared CI runner
      // swings enough to flip a 0.90 gate on noise alone.
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        // CI containers have no sandbox; --headless=new matches what
        // Chrome actually ships.
        chromeFlags: '--no-sandbox --headless=new --disable-dev-shm-usage',
        // Nothing here is a PWA, and the category only ever emits noise.
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },
    assert: {
      // Per-URL, because the static and dynamic pages CANNOT score the
      // same on SEO, and flattening that to one threshold hides the thing
      // this gate exists to catch.
      //
      // `assertMatrix` MUST nest under `assert`. As a sibling of it, LHCI
      // finds no assertions, prints nothing, and exits 0 — a gate that
      // silently passes everything. `lhci assert` standalone says "No
      // assertions to use"; `autorun` does not even say that much.
      assertMatrix: [
        {
          // Static marketing pages. `seo: 1.0` is not perfectionism — it is
          // the regression detector. Next defers EVERY `<head>` tag past
          // `</head>` on a dynamic route, so the moment one of these pages
          // picks up a per-request read, its title/description/canonical/og
          // tags leave the head, `meta-description` fails, and this drops
          // to 0.91. That is precisely how the `/` regression was found.
          matchingUrlPattern: 'http://localhost:4173/(security|how-to/.*)?$',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:best-practices': ['error', { minScore: 0.95 }],
            'categories:seo': ['error', { minScore: 1 }],
          },
        },
        {
          // `/pricing` is dynamic by decision (D117 rail at the point of
          // sale), so its `<head>` tags are deferred and `meta-description`
          // scores 0. 0.9 is the honest floor for that trade, NOT a target.
          // If /pricing ever goes static, raise this to 1 with the others.
          matchingUrlPattern: 'http://localhost:4173/pricing$',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:best-practices': ['error', { minScore: 0.95 }],
            'categories:seo': ['error', { minScore: 0.9 }],
          },
        },
      ],
    },
    upload: {
      // No LHCI server; keep the reports as CI artifacts instead.
      target: 'filesystem',
      outputDir: './.lighthouseci',
      reportFilenamePattern: '%%PATHNAME%%-report.%%EXTENSION%%',
    },
  },
};
