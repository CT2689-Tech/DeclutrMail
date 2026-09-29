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
 */
describe('ActionsService DI shape', () => {
  it('every constructor param is either @Inject()-tagged OR @Optional()', () => {
    // Nest's `@Optional()` stores constructor indexes as a number array
    // (`optional:paramtypes`). `@Inject()` stores `{ index, param }` on
    // `self:paramtypes`. Every ctor index must appear in one of those
    // sets — else Nest tries to resolve by class identity and crashes
    // at boot. Vite 8 emits `design:paramtypes`, so this loop actually
    // sees the parameters; an empty list would pass without checking.
    const paramTypes: unknown[] =
      (Reflect.getMetadata('design:paramtypes', ActionsService) as unknown[]) ?? [];
    const optionalDeps: Array<number | { index: number }> =
      (Reflect.getMetadata(OPTIONAL_DEPS_METADATA, ActionsService) as
        Array<number | { index: number }> | undefined) ?? [];
    const explicitInjects: Array<{ index: number }> =
      (Reflect.getMetadata('self:paramtypes', ActionsService) as
        Array<{ index: number }> | undefined) ?? [];

    const optionalSet = new Set(
      optionalDeps.map((dep) => (typeof dep === 'number' ? dep : dep.index)),
    );
    const injectSet = new Set(explicitInjects.map((d) => d.index));

    expect(
      paramTypes.length,
      'design:paramtypes was empty, so this check never looked at the constructor',
    ).toBeGreaterThan(0);

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
