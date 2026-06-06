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
    // Nest stores per-param optional flags as `[{ index: <n> }, ...]`
    // on the class itself. Combined with the `self:paramtypes`
    // metadata (`@Inject(TOKEN)` overrides), every ctor index must
    // appear in ONE of the two sets — else Nest tries to resolve by
    // class identity and crashes at boot.
    const paramTypes: unknown[] =
      (Reflect.getMetadata('design:paramtypes', ActionsService) as unknown[]) ?? [];
    const optionalDeps: Array<{ index: number }> =
      (Reflect.getMetadata(OPTIONAL_DEPS_METADATA, ActionsService) as
        | Array<{ index: number }>
        | undefined) ?? [];
    const explicitInjects: Array<{ index: number }> =
      (Reflect.getMetadata('self:paramtypes', ActionsService) as
        | Array<{ index: number }>
        | undefined) ?? [];

    const optionalSet = new Set(optionalDeps.map((d) => d.index));
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
