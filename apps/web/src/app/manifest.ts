// manifest.webmanifest (D132 SEO batch — favicon completeness).
//
// Served at /manifest.webmanifest and auto-linked by Next. The PNG set
// under public/icons/ (and app/apple-icon.png + app/favicon.ico) is
// rasterized from app/icon.svg — the single design source; regenerate
// the PNGs from that SVG if it ever changes. Colors are the existing
// brand hexes (see opengraph-image.tsx). `display: 'browser'` on
// purpose: DeclutrMail is not shipping as an installable PWA at launch.

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DeclutrMail',
    short_name: 'DeclutrMail',
    description: 'A Gmail sender-control companion with live previews and Activity undo.',
    start_url: '/',
    display: 'browser',
    background_color: '#FAFAF7',
    theme_color: '#006B5F',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
