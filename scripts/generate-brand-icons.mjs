#!/usr/bin/env node
// Regenerates every rasterised brand asset from the geometry in ADR-0036.
//
//   node scripts/generate-brand-icons.mjs [--check]
//
// --check re-renders into memory and diffs against what is on disk, exiting
// non-zero on drift. Nothing else in the repo tests these files: a stale PNG
// fails no type check, no unit test and no gate, so this is the only thing
// standing between a geometry edit and a wrong icon shipping.
//
// WHY THIS SCRIPT EXISTS AT ALL
//
// app/icon.svg used to be the single rasterisation source for the whole set.
// It cannot be any more. The mark is drawn at two cuts (ADR-0036 §Two cuts),
// and which cut is correct depends on how big the MARK renders — not how big
// the tile is. Inside a tile the mark is 75% of the tile, so:
//
//     16px tile -> 12px mark -> compact cut
//     32px tile -> 24px mark -> compact cut  (24 is the boundary, inclusive)
//    180px tile -> 135px mark -> regular cut
//
// Feeding one file to every size would ship the app icon at favicon stroke
// weight, which is the exact smudge the two cuts exist to prevent. The split
// is therefore explicit below and must stay explicit.

import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const TEAL = '#006B5F';
const MINT = '#79E6DC';
const PAPER = '#FAFAF7';

/**
 * The two cuts, exactly as `packages/shared/src/components/logo.tsx` draws
 * them. Kept literal here rather than imported: this script runs outside the
 * TS build, and a divergence is caught by the contract test below.
 */
const CUTS = {
  // 16-unit grid: one unit is one device pixel at favicon size.
  compact: {
    viewBox: '0 0 16 16',
    frame: 'M7 4H4A2 2 0 0 0 2 6V11A2 2 0 0 0 4 13H10A2 2 0 0 0 12 11V10',
    tail: 'M1 5L7 9L15 3',
    stroke: 2,
  },
  regular: {
    viewBox: '-3 -5 71 71',
    frame: 'M42 16H11a7 7 0 0 0-7 7v20a7 7 0 0 0 7 7h34a7 7 0 0 0 7-7V30',
    tail: 'M7 21.5L30 37.5L61 13.5',
    stroke: 5.5,
  },
};

/** The mark renders at 75% of the tile — see the cut-selection note above. */
const MARK_SCALE = 0.75;
const cutFor = (tilePx) => (tilePx * MARK_SCALE <= 24 ? CUTS.compact : CUTS.regular);

/**
 * Card lockup — the mark inside a filled teal tile, which is what every icon
 * surface actually shows. `inset` is the fraction of the tile left as padding
 * on each side; 0.125 puts the mark at 75%.
 *
 * `safeArea` shrinks the mark further for the Android maskable icon, where the
 * platform may crop anything outside the middle 80% into any shape it likes.
 */
function lockupSvg(px, { radius, inset = 0.125, safeArea = 1, cut = null } = {}) {
  const c = cut ?? cutFor(px);
  const [vx, vy, vw] = c.viewBox.split(' ').map(Number);
  // Work in a 16-unit outer canvas so the tile radius reads as a percentage
  // of the tile regardless of which cut's viewBox is being placed inside it.
  const scale = (16 * (1 - 2 * inset) * safeArea) / vw;
  const tx = (16 - vw * scale) / 2 - vx * scale;
  const ty = (16 - vw * scale) / 2 - vy * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="${radius}" fill="${TEAL}"/>
  <g transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)}) scale(${scale.toFixed(6)})" fill="none">
    <path d="${c.frame}" stroke="${PAPER}" stroke-width="${c.stroke}" stroke-linecap="round"/>
    <path d="${c.tail}" stroke="${MINT}" stroke-width="${c.stroke}" stroke-linejoin="round" stroke-linecap="round"/>
  </g>
</svg>`;
}

const png = (svg, px) =>
  sharp(Buffer.from(svg)).resize(px, px).png({ compressionLevel: 9 }).toBuffer();

/**
 * Minimal ICO container. sharp cannot write .ico, and the format allows raw
 * PNG payloads per entry, which every browser in support has handled for
 * years — so this needs no dependency beyond the PNGs themselves.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/** Every rasterised asset, with the cut each one resolves to made explicit. */
async function build() {
  const out = new Map();

  // Next.js serves app/icon.svg as the site icon, and browsers hand it to
  // small slots (tab, bookmark bar), so it carries the COMPACT cut. Generated
  // rather than hand-authored so it cannot drift from the PNGs beside it.
  out.set(
    'apps/web/src/app/icon.svg',
    Buffer.from(
      `<!-- Generated by scripts/generate-brand-icons.mjs — do not edit by hand.\n     Geometry is specification: see docs/adr/0036-brand-logo.md. -->\n` +
        lockupSvg(64, { radius: 3.5, cut: CUTS.compact }).replace('width="64" height="64" ', '') +
        '\n',
    ),
  );

  // Favicon: 16/32/48 in one .ico. At 48 the mark is 36px, so it takes the
  // regular cut while 16 and 32 take the compact one — cutFor handles it.
  const ico = [];
  for (const size of [16, 32, 48]) {
    ico.push({ size, data: await png(lockupSvg(size, { radius: 3.5 }), size) });
  }
  out.set('apps/web/src/app/favicon.ico', buildIco(ico));

  // iOS home screen. Apple applies its own mask, so the tile is drawn square
  // and the platform rounds it.
  out.set('apps/web/src/app/apple-icon.png', await png(lockupSvg(180, { radius: 0 }), 180));

  // Android / PWA.
  out.set('apps/web/public/icons/icon-192.png', await png(lockupSvg(192, { radius: 3.5 }), 192));
  out.set('apps/web/public/icons/icon-512.png', await png(lockupSvg(512, { radius: 3.5 }), 512));

  // Maskable: full-bleed tile, mark pulled into the middle 80% so any crop
  // shape the launcher picks still contains the whole mark.
  out.set(
    'apps/web/public/icons/icon-512-maskable.png',
    await png(lockupSvg(512, { radius: 0, safeArea: 0.8 }), 512),
  );

  // Google OAuth consent. Google circle-crops this on some surfaces, so it
  // uses the same safe-area treatment as the maskable icon.
  out.set(
    'docs/brand/oauth-consent-logo-120.png',
    await png(lockupSvg(120, { radius: 0, safeArea: 0.85 }), 120),
  );

  return out;
}

const assets = await build();

if (CHECK) {
  let drift = 0;
  for (const [rel, want] of assets) {
    const got = await readFile(join(ROOT, rel)).catch(() => null);
    if (got === null) {
      console.error(`✗ missing   ${rel}`);
      drift++;
    } else if (!got.equals(want)) {
      console.error(`✗ stale     ${rel}  (on disk ${got.length}B, regenerated ${want.length}B)`);
      drift++;
    } else {
      console.log(`✓ current   ${rel}`);
    }
  }
  if (drift > 0) {
    console.error(`\n${drift} brand asset(s) do not match ADR-0036 geometry.`);
    console.error('Run: node scripts/generate-brand-icons.mjs');
    process.exit(1);
  }
  console.log('\nAll brand assets match the geometry in ADR-0036.');
} else {
  for (const [rel, data] of assets) {
    await writeFile(join(ROOT, rel), data);
    console.log(`wrote ${rel}  (${data.length}B)`);
  }
  console.log('\nDone. Re-run with --check to verify nothing has drifted.');
}
