import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/**
 * GmailConnectEnabledGuard (D4) — env-gates the Gmail OAuth connect
 * routes until the D109/D224 app auth layer exists.
 *
 * The connect routes are unauthenticated for now, so they stay OFF by
 * default: a deployed env cannot reach them unless `GMAIL_CONNECT_ENABLED`
 * is explicitly `true`. When disabled, the guard throws `NotFoundException`
 * (404) rather than 403 — a denied caller is not told the route exists.
 */
@Injectable()
export class GmailConnectEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.GMAIL_CONNECT_ENABLED !== 'true') {
      throw new NotFoundException();
    }
    return true;
  }
}
