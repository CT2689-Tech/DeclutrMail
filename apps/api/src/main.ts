import 'reflect-metadata';

import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { correlationMiddleware } from './common/correlation.middleware.js';
import { initSentry } from './observability/sentry.js';

/**
 * Parse `CORS_ORIGIN` into a value the `cors` middleware accepts.
 *
 * Accepted env shapes:
 *   - unset / empty            → localhost-only regex (dev default)
 *   - `"https://app.foo.com"`  → single exact origin (string)
 *   - `"https://a.com,https://b.com"` → multiple exact origins (string[])
 *   - `"/^https:\\/\\/.*\\.vercel\\.app$/"` → regex literal (RegExp).
 *     The leading/trailing `/` delimits; an optional final `i`/`g`/etc.
 *     flag block is forwarded.
 *
 * The regex form is mandatory for Vercel preview deploys: each preview
 * gets a fresh `declutr-mail-<hash>-…vercel.app` URL, so an exact
 * string match would only allow ONE deploy through. Regex covers them
 * all in one rule.
 */
function parseCorsOrigin(raw: string | undefined): string | string[] | RegExp {
  if (!raw || raw.trim() === '') return /^http:\/\/localhost(:\d+)?$/;
  const trimmed = raw.trim();
  // Regex literal — `/pattern/flags` (flags optional). Match captures
  // the body + the flag block separately so we can rebuild a fresh
  // RegExp instance the `cors` middleware will accept.
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    return new RegExp(regexMatch[1]!, regexMatch[2]);
  }
  // Comma-separated list of exact origins.
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return trimmed;
}

/**
 * API bootstrap (D201). Global `api` prefix so every route is under
 * `/api/...` (matches the GOOGLE_REDIRECT_URI in .env.example). The
 * global exception filter maps every error to the D202 envelope.
 * `cookieParser` populates `req.cookies` for the OAuth `state` check (D4).
 *
 * Sentry (D159) initializes BEFORE `NestFactory.create` so any error
 * thrown during DI / module bootstrap is captured. No-op when
 * `SENTRY_DSN` is unset.
 *
 * `trust proxy` is enabled so `req.ip` reflects the real client IP from
 * `X-Forwarded-For` instead of the load-balancer hop — the rate
 * limiter (D156) keys unauthenticated requests off `req.ip`. Cloud Run
 * sits behind Google's frontend; the chain is stable, so trusting the
 * proxy header is safe in this environment.
 */
async function bootstrap(): Promise<void> {
  // Fail-fast guard: the dev test-login (DevAuthController) is an auth
  // bypass that must NEVER be reachable in production. Refuse to boot if
  // the prod + enabled combination is ever configured (D206).
  if (process.env.NODE_ENV === 'production' && process.env.DEV_AUTH_ENABLED === 'true') {
    throw new Error('DEV_AUTH_ENABLED must never be set when NODE_ENV=production.');
  }

  await initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  // CORS (D179). Without this, the FE on :3000 cannot reach the API
  // on :4000 — the preflight OPTIONS is rejected with 404 and the
  // GET surfaces as a 503 (network error) in the browser console.
  // Dev default: any localhost origin. Prod: lock to FE origin(s) via
  // CORS_ORIGIN env var. Accepted shapes:
  //   "https://app.declutrmail.com"                 — single exact origin
  //   "https://a.com,https://b.com"                  — comma-separated list
  //   "/^https:\/\/declutr-mail.*\.vercel\.app$/"    — regex literal
  // Vercel previews need the regex form because each deploy gets a
  // fresh URL hash; a single exact string would only match one deploy.
  // D155 cookie-auth requires `credentials: true` so the browser
  // sends the HttpOnly access cookie cross-origin. The allowed headers
  // include `X-CSRF-Token` for the double-submit CSRF pattern. The
  // legacy `x-mailbox-account-id` header is gone — mailbox identity
  // now comes from the session + `users.preferences.activeMailboxId`.
  app.enableCors({
    origin: parseCorsOrigin(process.env.CORS_ORIGIN),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'X-CSRF-Token',
      // Per-request mailbox override (CurrentMailboxGuard, D155 + D205).
      // The web client stamps it whenever a hook passes `mailboxId`.
      'X-Active-Mailbox-Id',
      'Idempotency-Key',
    ],
  });
  app.setGlobalPrefix('api');
  // Correlation IDs (D168) must be stamped before any handler or the
  // exception filter runs, so every request — success or error — carries
  // a correlationId / displayId the response, logs, and Sentry join on.
  app.use(correlationMiddleware);
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

void bootstrap();
