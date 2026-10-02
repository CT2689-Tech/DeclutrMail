// Loaded by instrumentation.ts for the edge runtime. Request errors are
// captured explicitly through onRequestError; auto-instrumentation stays off.
import * as Sentry from '@sentry/nextjs';
import { initSentryServerRuntime } from './src/lib/sentry-server-runtime';

initSentryServerRuntime(Sentry);
