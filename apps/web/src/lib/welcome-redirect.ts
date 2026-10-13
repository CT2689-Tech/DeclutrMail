/**
 * Paddle's dashboard default payment link is `/welcome`. Hosted payment
 * links, recovery mail, invoice mail, and server-created transactions
 * append `?_ptxn=<transaction id>` and request that path. It is not a
 * route.
 *
 * The destination carries no query string. Next.js merges the request
 * query onto a redirect destination (`prepareDestination` in the router,
 * with `appendParamsToQuery: false`), so `_ptxn` arrives on `/billing`.
 * Paddle.js reads that parameter when `Paddle.Initialize` runs.
 */
import type { NextConfig } from 'next';

type Redirect = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>[number];

export function welcomeRedirect(): Redirect {
  return { source: '/welcome', destination: '/billing', permanent: true };
}
