import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

/**
 * Emit one structured `http.request` line per API call (D150, D159).
 *
 * Why. pg_stat_statements tells us which SQL is slow; it cannot tell us
 * which HTTP route waited on it. Sentry is web-only. Without a per-route
 * duration we keep guessing whether a 5s `/api/senders/summary` is the
 * query, the lock, or the JS waterfall.
 *
 * Privacy (D7): method + route TEMPLATE + status + duration_ms +
 * correlationId. Never the raw URL (query strings and path params can
 * carry sender emails), never the body, never mailbox content.
 *
 * Probes (`healthz` / `readyz`) are skipped — Cloud Run hits them
 * continuously and they would drown the log.
 */
@Injectable()
export class RequestTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const controllerPath = nestPath(context.getClass());
    if (controllerPath === 'healthz' || controllerPath === 'readyz') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const started = Date.now();
    const route = routeTemplate(context, req, controllerPath);

    return next.handle().pipe(
      tap({
        next: () => emit(req, route, res.statusCode, started),
        error: (err: unknown) => emit(req, route, statusFrom(err), started),
      }),
    );
  }
}

function nestPath(target: object): string {
  const raw = Reflect.getMetadata(PATH_METADATA, target) as unknown;
  return typeof raw === 'string' ? raw : '';
}

function routeTemplate(context: ExecutionContext, req: Request, controllerPath: string): string {
  const handlerPath = nestPath(context.getHandler());
  const nested = [controllerPath, handlerPath].filter((part) => part.length > 0).join('/');
  if (nested.length > 0) {
    return `${req.method} /api/${nested}`.replace(/\/{2,}/g, '/');
  }
  const expressPath = req.route && typeof req.route.path === 'string' ? req.route.path : null;
  if (expressPath) {
    const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
    return `${req.method} ${base}${expressPath}`;
  }
  return `${req.method} unmatched`;
}

function statusFrom(err: unknown): number {
  if (err instanceof HttpException) {
    return err.getStatus();
  }
  return 500;
}

function emit(req: Request, route: string, status: number, started: number): void {
  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'http.request',
      method: req.method,
      route,
      status,
      duration_ms: Date.now() - started,
      correlationId: req.correlationId ?? null,
    }),
  );
}
