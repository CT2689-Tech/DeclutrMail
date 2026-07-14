import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const facade = vi.hoisted(() => ({
  schedule: vi.fn(),
  transition: vi.fn(),
}));

vi.mock('@/lib/sentry', () => ({
  scheduleSentryBrowserInit: facade.schedule,
  captureRouterTransitionStart: facade.transition,
}));

describe('instrumentation-client contract', () => {
  beforeEach(() => {
    facade.schedule.mockClear();
    facade.transition.mockClear();
  });

  it('schedules lazy init and exposes a synchronous router wrapper', async () => {
    vi.resetModules();
    const instrumentation = await import('../../instrumentation-client');

    expect(facade.schedule).toHaveBeenCalledTimes(1);
    expect(instrumentation.onRouterTransitionStart('/pricing', 'push')).toBeUndefined();
    expect(facade.transition).toHaveBeenCalledWith('/pricing', 'push');
  });

  it('keeps the universal entry and facade free of static Sentry SDK imports', () => {
    const instrumentationSource = readFileSync(
      path.join(process.cwd(), 'instrumentation-client.ts'),
      'utf8',
    );
    const facadeSource = readFileSync(path.join(process.cwd(), 'src/lib/sentry.ts'), 'utf8');

    expect(instrumentationSource).not.toContain("from '@sentry/nextjs'");
    expect(facadeSource).not.toContain("from '@sentry/nextjs'");
    expect(facadeSource).toContain("import('./sentry-browser-runtime')");
  });
});
