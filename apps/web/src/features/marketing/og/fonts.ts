// Brand fonts for Open Graph cards.
//
// `ImageResponse` registers no fonts by default, so Satori falls back to its
// bundled Noto Sans and every word on both share cards renders in a face the
// brand does not use. The cards are the surface strangers meet the brand
// through, so the mismatch is worth ~210KB of build-time binaries.
//
// Both families are registered, not just the display one. Satori uses the
// FIRST registered font for anything without an explicit `fontFamily`, so
// shipping Fraunces alone sets the body copy in the display face too — an
// error of the opposite kind, and a more conspicuous one. Geist is therefore
// first and Fraunces is opt-in via OG_DISPLAY.
//
// WHY THE FILES ARE COMMITTED RATHER THAN FETCHED
//
// The Next.js docs show fetching fonts from Google at render time. That makes
// OG generation fail whenever fonts.googleapis.com is unreachable from the
// build machine — a network dependency on assets that never change. Both
// families are SIL OFL 1.1 (Fraunces-OFL.txt, Geist-OFL.txt beside this file),
// which permits redistribution, so they are vendored instead.
//
// WHY TTF, AND WHY STATIC INSTANCES
//
// Satori reads ttf, otf and woff — NOT woff2, which is what Google Fonts
// serves to any modern user agent. These are static instances rather than
// variable faces: Satori applies no variation axes, so a variable Fraunces
// would render at its default weight and silently ignore `fontWeight: 800`.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Paths are relative to apps/web, which is process.cwd() during `next build`. */
const DIR = 'src/features/marketing/og';

const FACES = [
  // Geist first: it becomes Satori's default for unstyled text.
  { file: 'Geist-Regular.ttf', name: 'Geist', weight: 400 },
  { file: 'Geist-Bold.ttf', name: 'Geist', weight: 700 },
  { file: 'Fraunces-ExtraBold.ttf', name: 'Fraunces', weight: 800 },
] as const;

/** Cached across cards within a build — both OG routes prerender in one pass. */
let cached: Promise<Awaited<ReturnType<typeof read>>[]> | null = null;

async function read(face: (typeof FACES)[number]) {
  // Resolved from process.cwd(), NOT `new URL('./…', import.meta.url)`.
  //
  // The URL form is the more obvious way to reference a file next to its
  // module, and it compiles clean and passes `next dev` — then fails the
  // production prerender with "The path argument must be of type string or an
  // instance of URL. Received an instance of URL". Webpack substitutes its own
  // URL implementation, so Node's instanceof check rejects it; wrapping in
  // fileURLToPath fails identically, for the same reason. Only a production
  // build surfaces this, because `next dev` runs the route unbundled.
  //
  // Safe because both OG routes prerender at build time, where cwd is apps/web
  // and the whole source tree is present. If either route is ever made dynamic
  // it would run in a serverless function instead, and these assets would need
  // adding to outputFileTracingIncludes.
  return {
    name: face.name,
    data: await readFile(join(process.cwd(), DIR, face.file)),
    weight: face.weight,
    style: 'normal' as const,
  };
}

/** Font set for `new ImageResponse(element, { ...size, fonts: await ogFonts() })`. */
export async function ogFonts() {
  cached ??= Promise.all(FACES.map(read));
  return cached;
}

/**
 * Display type. ADR-0036 locks Fraunces 800 for the wordmark and headline.
 *
 * Only weight 800 of Fraunces is vendored — asking Satori for another weight
 * of this family falls back to Geist rather than synthesising one, so keep
 * `fontWeight: 800` wherever this is spread.
 */
export const OG_DISPLAY = {
  fontFamily: 'Fraunces',
  fontWeight: 800,
} as const;
