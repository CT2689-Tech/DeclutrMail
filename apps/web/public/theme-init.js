// Theme resolver — runs synchronously before first paint (parser-
// blocking <script> at the top of <body>, nonced per D175 CSP) so a
// stored dark preference never flashes light.
//
// Mirrors apps/web/src/features/theme/theme.ts: storage key 'dm-theme'
// ('light' | 'dark'); anything else falls back to the OS preference.
// Keep the two in sync — this file is a static asset and cannot import.
/* global window, document */
(function () {
  try {
    var t = localStorage.getItem('dm-theme');
    if (t !== 'light' && t !== 'dark') {
      t =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
