import { beforeEach, describe, expect, it, vi } from 'vitest';
const report = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureRequestError: report }));

import { onRequestError } from '../../instrumentation';
import {
  isStreamedQueryRecoveryError,
  StreamedQueryRecoveryError,
} from './streamed-query-recovery';

const request = { path: '/autopilot', method: 'GET', headers: {} };
const context = {
  routerKind: 'App Router',
  routePath: '/autopilot',
  routeType: 'render',
  renderSource: 'react-server-components',
} as const;

describe('optional stream transport diagnostics', () => {
  beforeEach(() => report.mockReset());
  it('suppresses only the safe recovery transport marker', async () => {
    const error = new StreamedQueryRecoveryError();
    expect(isStreamedQueryRecoveryError(error)).toBe(true);
    await onRequestError(error, request, context);
    expect(report).not.toHaveBeenCalled();
  });
  it.each([
    new Error('redacted'),
    new Error('Unexpected renderer failure'),
    Object.assign(new Error('Different failure'), { name: 'DeclutrMailStreamedQueryRecovery' }),
  ])('continues reporting unrelated failures: %s', async (error) => {
    expect(isStreamedQueryRecoveryError(error)).toBe(false);
    await onRequestError(error, request, context);
    expect(report).toHaveBeenCalledWith(error, request, context);
  });
  it('keeps telemetry failure optional', async () => {
    report.mockRejectedValueOnce(new Error('Telemetry unavailable'));
    await expect(
      onRequestError(new Error('Original failure'), request, context),
    ).resolves.toBeUndefined();
  });
});
