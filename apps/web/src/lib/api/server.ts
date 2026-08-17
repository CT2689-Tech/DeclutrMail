import 'server-only';

import type { Envelope } from '@declutrmail/shared/contracts';

const SERVER_READ_TIMEOUT_MS = 3_000;

export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }
}

export async function serverGetEnvelope<T, Meta = unknown>(
  path: string,
  cookieHeader: string,
  signal?: AbortSignal,
): Promise<Envelope<T, Meta>> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) {
    throw new Error('NEXT_PUBLIC_API_URL is required for server API reads.');
  }

  const response = await fetch(`${apiBase}${path}`, {
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(SERVER_READ_TIMEOUT_MS)])
      : AbortSignal.timeout(SERVER_READ_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader,
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new ServerApiError(
      response.status,
      body,
      `GET ${path} failed: ${response.status} ${response.statusText}`,
    );
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !Object.prototype.hasOwnProperty.call(body, 'data')
  ) {
    throw new ServerApiError(
      response.status,
      body,
      `GET ${path} returned a non-envelope payload — expected { data, meta? }`,
    );
  }

  return body as Envelope<T, Meta>;
}

export async function serverGet<T>(
  path: string,
  cookieHeader: string,
  signal?: AbortSignal,
): Promise<T> {
  const envelope = await serverGetEnvelope<T>(path, cookieHeader, signal);
  return envelope.data;
}
