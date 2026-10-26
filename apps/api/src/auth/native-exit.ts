import type { Response } from 'express';

import {
  buildNativeReturnUrl,
  isNativeSafePath,
  type NativeReturn,
} from '@declutrmail/shared/contracts';

/**
 * Where a native sign-in or connect flow ends (ADR-0049).
 *
 * The flow runs in the system browser, but the person's real place is the
 * app. The callback and its exit filters finish with
 * `res.redirect(`${webBase}${path}`)` at some twenty sites, each choosing the
 * web page that explains an outcome (Settings with a closed result, the
 * sign-in page with a reason, onboarding). Rather than fork every site, a
 * native flow translates those redirects once: a redirect into the web app
 * becomes a return to the app that navigates its WebView to the same path.
 * A redirect anywhere else, notably to Google, passes through untouched.
 */

/** The path of `url` inside the web app, or null when it points elsewhere. */
export function webPathOf(webBase: string, url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const base = webBase.replace(/\/+$/, '');
  if (!url.startsWith(`${base}/`)) return null;
  const path = url.slice(base.length);
  return isNativeSafePath(path) ? path : null;
}

/** Turn this response's redirects into the web app into returns to the app. */
export function interceptNativeRedirects(res: Response, webBase: string): void {
  const original = res.redirect.bind(res) as (...args: unknown[]) => void;
  res.redirect = ((statusOrUrl: number | string, maybeUrl?: string) => {
    const path = webPathOf(webBase, typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl);
    if (path === null) {
      original(...(maybeUrl === undefined ? [statusOrUrl] : [statusOrUrl, maybeUrl]));
      return;
    }
    sendNativeReturn(res, { kind: 'navigate', to: path });
  }) as Response['redirect'];
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The page that hands the person back to the app. It needs no script. The
 * link opens on its own where the browser allows a redirect to an app
 * scheme, and the button is the path that always works, because a browser
 * may refuse to open an app without a tap. The tap target is 52px tall.
 */
function returnPage(link: string): string {
  const href = escapeAttribute(link);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="refresh" content="0;url=${href}">
<title>DeclutrMail</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;font:16px/1.5 system-ui,-apple-system,sans-serif}
h1{font-size:20px;margin:0}
a{display:inline-block;margin-top:16px;padding:14px 24px;border-radius:10px;background:#111;color:#fff;text-decoration:none;font-weight:600}
@media(prefers-color-scheme:dark){a{background:#fff;color:#111}}
</style>
</head>
<body>
<main>
<h1>Back to DeclutrMail</h1>
<a href="${href}">Open DeclutrMail</a>
</main>
</body>
</html>
`;
}

/** Answer with the return page. The link carries a code or a path, never a token. */
export function sendNativeReturn(res: Response, result: NativeReturn): void {
  if (res.headersSent) return;
  res
    .status(200)
    .type('html')
    .set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    })
    .send(returnPage(buildNativeReturnUrl(result)));
}
