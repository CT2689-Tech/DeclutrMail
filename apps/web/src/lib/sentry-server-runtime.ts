import type * as Sentry from '@sentry/nextjs';
import {
  isSentryEnvironmentEnabled,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '@declutrmail/shared/observability';

/** Shared Node/edge privacy boundary. Sentry is optional and exceptions-only here. */
export function initSentryServerRuntime(sdk: Pick<typeof Sentry, 'init'>): boolean {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (
    !dsn ||
    !isSentryEnvironmentEnabled({
      runtimeEnvironment: process.env.NODE_ENV,
      deploymentEnvironment: process.env.VERCEL_ENV,
      developmentOptIn: process.env.SENTRY_DEV_ENABLED,
    })
  )
    return false;
  const release = process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE;
  try {
    sdk.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      ...(release ? { release } : {}),
      tracesSampleRate: 0,
      traceLifecycle: 'static',
      sendClientReports: false,
      defaultIntegrations: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        frameContextLines: 0,
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        graphQL: { document: false, variables: false },
      },
      beforeSend: (event) =>
        scrubSentryEvent(event as unknown as Record<string, unknown>, 'server') as unknown as
          typeof event | null,
      beforeBreadcrumb: (breadcrumb) =>
        scrubSentryBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as unknown as
          typeof breadcrumb | null,
      beforeSendTransaction: () => null,
      beforeSendLog: () => null,
      beforeSendMetric: () => null,
    });
    return true;
  } catch {
    // Never log the SDK error: it may contain a DSN or private request data.
    console.warn(JSON.stringify({ level: 'warn', kind: 'sentry.init_failed' }));
    return false;
  }
}
