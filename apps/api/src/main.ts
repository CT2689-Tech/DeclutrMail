import 'reflect-metadata';

import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { initSentry } from './observability/sentry.js';

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
  await initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  // CORS (D179). Without this, the FE on :3000 cannot reach the API
  // on :4000 — the preflight OPTIONS is rejected with 404 and the
  // GET surfaces as a 503 (network error) in the browser console.
  // Dev default: any localhost origin. Prod: lock to FE origin via
  // CORS_ORIGIN env var.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? /^http:\/\/localhost(:\d+)?$/,
    credentials: true,
    allowedHeaders: ['Content-Type', 'x-mailbox-account-id', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

void bootstrap();
