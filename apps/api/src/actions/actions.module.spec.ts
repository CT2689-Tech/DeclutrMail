import 'reflect-metadata';
import { OPTIONAL_DEPS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { ActionsService } from './actions.service.js';

/**
 * Nest DI shape regression (architecture-guardian 2026-06-06).
 *
 * Reproduces the failure mode that nearly shipped: ActionsService
 * gained an OutboxPublisher ctor param without `@Optional()`, and no
 * test exercised module-level resolution. At runtime, Nest reads
 * `design:paramtypes`, fails to find a provider for OutboxPublisher,
 * and throws 'Nest can't resolve dependencies of the ActionsService'
 * at boot.
 *
 * Strategy: introspect the ActionsService constructor's optional-
 * dependency metadata directly. Any future ctor param added without
 * either `@Inject(TOKEN)` or `@Optional()` will fail this assertion;
 * the test stays decoupled from the DbModule / AuthModule / Mailbox-
 * AccountsModule provider graph so it's stable across refactors.
 *
 * Nest's `@Optional()` stores ctor indices as numbers
 * (`[...args, index]`). Vite 7/esbuild's decorator helper sometimes
 * wrapped that third argument as `{ index }`; Vite 8/Oxc stores the
 * number Nest actually reads via `optionalDependenciesIds.includes`.
 */
function optionalCtorIndex(entry: unknown): number | undefined {
  if (typeof entry === 'number' && Number.isInteger(entry)) return entry;
  if (
    typeof entry === 'object' &&
    entry !== null &&
    'index' in entry &&
    typeof (entry as { index: unknown }).index === 'number'
  ) {
    return (entry as { index: number }).index;
  }
  return undefined;
}

describe('ActionsService DI shape', () => {
  it('every constructor param is either @Inject()-tagged OR @Optional()', () => {
    const paramTypes: unknown[] =
      (Reflect.getMetadata('design:paramtypes', ActionsService) as unknown[]) ?? [];
    const optionalDeps: unknown[] =
      (Reflect.getMetadata(OPTIONAL_DEPS_METADATA, ActionsService) as unknown[] | undefined) ?? [];
    const explicitInjects: Array<{ index: number }> =
      (Reflect.getMetadata('self:paramtypes', ActionsService) as
        Array<{ index: number }> | undefined) ?? [];

    // Empty paramtypes would skip the loop and pass even if Oxc dropped
    // `emitDecoratorMetadata` — starve that false green.
    expect(paramTypes.length).toBeGreaterThan(0);

    const optionalSet = new Set(
      optionalDeps.map(optionalCtorIndex).filter((i): i is number => i !== undefined),
    );
    const injectSet = new Set(explicitInjects.map((d) => d.index));

    for (let i = 0; i < paramTypes.length; i++) {
      const isInjected = injectSet.has(i);
      const isOptional = optionalSet.has(i);
      expect(
        isInjected || isOptional,
        `ActionsService ctor param at index [${i}] is neither @Inject(TOKEN) nor @Optional() — Nest will fail to resolve it at boot.`,
      ).toBe(true);
    }
  });
});
