import 'reflect-metadata';

import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';

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
 */
async function bootstrap(): Promise<void> {
  await initSentry();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

void bootstrap();
