import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor shell for the DeclutrMail prototype (apps/mobile/README.md,
// ADR-0047).
//
// The shell bundles no web code: the WebView loads CAP_SERVER_URL, so the
// phone runs whatever that URL serves. `webDir` holds only the page shown
// when the URL cannot be reached.

// Hosts where plain http is acceptable for a dev build: loopback, RFC 1918
// private ranges (10.0.2.2 is the Android emulator's route to the host
// machine), and mDNS names.
const LAN_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

function serverUrl(raw: string | undefined): URL {
  if (!raw) {
    throw new Error(
      'CAP_SERVER_URL is not set. Point it at the web app the shell should load, ' +
        'e.g. CAP_SERVER_URL=https://app.example.com pnpm sync (see apps/mobile/README.md).',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CAP_SERVER_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LAN_HOST.test(url.hostname)) return url;
  throw new Error(
    `CAP_SERVER_URL must be https://, or http:// on localhost or a private LAN address ` +
      `(got ${url.protocol}//${url.hostname}). Plain http to a public host is never allowed.`,
  );
}

const url = serverUrl(process.env.CAP_SERVER_URL);

const config: CapacitorConfig = {
  // The placeholder id keeps this build installable beside a future store app.
  // The bundle id / applicationId cannot change after the first store upload.
  appId: 'com.declutrmail.proto',
  appName: 'DeclutrMail',
  webDir: 'www',
  // Lets the web app (and PostHog) tell shell sessions from browser sessions.
  appendUserAgent: 'DeclutrMailShell',
  server: {
    url: url.toString(),
    cleartext: url.protocol === 'http:',
    errorPath: 'index.html',
  },
};

export default config;
