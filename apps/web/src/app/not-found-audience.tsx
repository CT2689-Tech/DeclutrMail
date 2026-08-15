'use client';

// Which destinations the 404 offers (D140), resolved lazily.
//
// It used to be read server-side from the session cookie's presence.
// That single `cookies()` call cost the ENTIRE public site its static
// prerendering: Next's root `not-found.tsx` is part of every route's
// render tree (it is the boundary any segment's `notFound()` lands in),
// so a per-request read here propagated to all 34 public pages — which
// is why nothing was prerendered before Option A′ (founder 2026-08-14),
// including pages that never mention a session.
//
// `dm_access` is HttpOnly, so the browser cannot read it. Audience is
// resolved the way every other public surface already resolves it under
// the D134 split — a lazy `GET /api/auth/me` probe (the same idiom as
// `features/marketing/pricing/cta.ts`, whose docblock states the rule:
// "marketing pages render with NO AuthProvider, so the page cannot know
// up front whether a session exists").
//
// Starting anonymous is the correct default, not a fallback: an
// anonymous visitor — the common case for a 404 — sees its final CTAs
// immediately with no swap, and a signed-in one sees them upgrade a
// moment later. A late CTA swap on an error page changes nothing the
// visitor has decided, which is why this trade is acceptable here and
// would NOT be on a page that quotes a price.

import { useEffect, useState } from 'react';

import { apiGet } from '@/lib/api/client';
import { ThemeFallback } from '@/features/theme/theme-fallback';
import { NotFoundView } from './not-found-view';

export function NotFoundAudience() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let live = true;
    void apiGet('/api/auth/me', { suppressAuthRedirect: true })
      .then(() => {
        if (live) setAuthed(true);
      })
      .catch(() => {
        // Not an error path: any failure — 401, expired refresh, API
        // unreachable — means "we cannot show app destinations", and the
        // anonymous CTAs already on screen are exactly that answer. The
        // probe is deliberately not retried; a 404 must never spin.
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      {/* No route group owns the root 404, so it gets no `<ThemeScript>`. */}
      <ThemeFallback />
      <NotFoundView authed={authed} />
    </>
  );
}
