/**
 * The Capacitor shell appends this token to the WebView's user agent
 * (`appendUserAgent` in apps/mobile/capacitor.config.ts, pinned by a test
 * there). It is the only signal the web app uses to know it is inside the
 * native app, so everything native is dead code in an ordinary browser.
 */
export const NATIVE_SHELL_UA_TOKEN = 'DeclutrMailShell';

export function isNativeShell(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(NATIVE_SHELL_UA_TOKEN);
}
