import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Capability, TierId } from '@declutrmail/shared/entitlements';
import { describe, expect, it, vi } from 'vitest';

import { AutopilotController } from '../../autopilot/autopilot.controller.js';
import { BriefController } from '../../briefs/brief.controller.js';
import { FollowupController } from '../../followups/followup.controller.js';
import { MailboxesController } from '../../mailboxes/mailboxes.controller.js';
import { SnoozedController } from '../../senders/snoozed.controller.js';
import { TriageController } from '../../triage/triage.controller.js';
import { AppException } from '../app-exception.js';
import { CapabilityGuard, CAPABILITY_METADATA } from './capability.guard.js';
import { assertTierCapability, type EntitlementsService } from './entitlements.service.js';

/**
 * D19 Pro-capability gate tests — `assertTierCapability` (the shared
 * 402) + `CapabilityGuard` run against the REAL controller classes so
 * every Pro surface's wiring is exercised per tier (the founder's dev
 * workspace may be pro; these seed the tier explicitly, mirroring the
 * screener spec's mocked-entitlements pattern).
 *
 * The per-surface `gated`/`exempt` lists are asserted EXHAUSTIVE
 * against the controller prototypes: adding a route to a gated
 * controller fails this spec until the route is classified.
 */

const PRINCIPAL = { userId: 'u1', workspaceId: 'ws-1', sessionId: 's1', jti: 'j1' };

/** Nest's internal `@UseGuards` metadata key (stable; used read-only here). */
const GUARDS_METADATA = '__guards__';

const PRO_TIERS: readonly TierId[] = ['pro', 'team', 'enterprise'];
const UNDER_TIERS: readonly TierId[] = ['free', 'plus'];
const PRO_CAPABILITIES: readonly Capability[] = [
  'autopilot',
  'brief',
  'screener',
  'quiet',
  'snoozed',
  'followups',
];

type ControllerClass = abstract new (...args: never[]) => unknown;

function handlerOf(controller: ControllerClass, name: string): (...args: never[]) => unknown {
  const fn = (controller.prototype as Record<string, unknown>)[name];
  if (typeof fn !== 'function') {
    throw new Error(`${controller.name}.${name} is not a method — did a route get renamed?`);
  }
  return fn as (...args: never[]) => unknown;
}

function makeCtx(opts: {
  controller: ControllerClass;
  handlerName: string;
  user?: typeof PRINCIPAL | undefined;
}): ExecutionContext {
  const req = { user: opts.user };
  return {
    getHandler: () => handlerOf(opts.controller, opts.handlerName),
    getClass: () => opts.controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(tier: TierId) {
  const tierForWorkspace = vi.fn(async () => tier);
  const guard = new CapabilityGuard(new Reflector(), {
    tierForWorkspace,
  } as unknown as EntitlementsService);
  return { guard, tierForWorkspace };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null).catch((e: unknown) => e);
}

describe('assertTierCapability (D19)', () => {
  it('402s free and plus for every Pro capability, with the manifest details', () => {
    for (const capability of PRO_CAPABILITIES) {
      for (const tier of UNDER_TIERS) {
        let err: unknown = null;
        try {
          assertTierCapability(tier, capability);
        } catch (e: unknown) {
          err = e;
        }
        expect(err, `${tier} × ${capability}`).toBeInstanceOf(AppException);
        expect((err as AppException).code).toBe('PRO_FEATURE_REQUIRED');
        expect((err as AppException).getStatus()).toBe(402);
        expect((err as AppException).details).toEqual({ capability, tier });
      }
    }
  });

  it('passes pro / team / enterprise for every Pro capability', () => {
    for (const capability of PRO_CAPABILITIES) {
      for (const tier of PRO_TIERS) {
        expect(
          () => assertTierCapability(tier, capability),
          `${tier} × ${capability}`,
        ).not.toThrow();
      }
    }
  });

  it('passes free-tier capabilities on the free tier', () => {
    expect(() => assertTierCapability('free', 'senders')).not.toThrow();
    expect(() => assertTierCapability('free', 'cleanup-actions')).not.toThrow();
  });

  it('keeps the screener 402 copy byte-identical to the pre-extraction D77 message', () => {
    let err: unknown = null;
    try {
      assertTierCapability('free', 'screener');
    } catch (e: unknown) {
      err = e;
    }
    expect((err as AppException).message).toBe(
      'The Screener is part of the Pro plan. Upgrade to review new senders in one place.',
    );
  });
});

describe('CapabilityGuard (D19) — per-surface wiring', () => {
  /**
   * Every route on these controllers must appear in exactly one of
   * `gated` / `exempt` — the exhaustiveness check below enforces it.
   */
  const SURFACES: ReadonlyArray<{
    surface: string;
    capability: Capability;
    controller: ControllerClass;
    gated: readonly string[];
    exempt: readonly string[];
  }> = [
    {
      surface: 'autopilot',
      capability: 'autopilot',
      controller: AutopilotController,
      gated: [
        'getRule',
        'listMatchesForRule',
        'patchRule',
        'pauseAll',
        'listPendingSuggestions',
        'getPatternSuggestion',
        'observePatternSuggestion',
        'dismissPatternSuggestion',
        'dismissMatch',
        'approveMatches',
        'approveAllForRule',
      ],
      // Catalog and dry-run preview are read-only pre-upgrade value.
      exempt: ['listRules', 'previewRule'],
    },
    {
      surface: 'briefs',
      capability: 'brief',
      controller: BriefController,
      gated: ['today', 'list', 'markOpened'],
      exempt: [],
    },
    {
      surface: 'followups',
      capability: 'followups',
      controller: FollowupController,
      gated: ['list', 'dismiss'],
      exempt: [],
    },
    {
      surface: 'snoozed',
      capability: 'snoozed',
      controller: SnoozedController,
      gated: ['list', 'patchSnooze', 'wakeNow'],
      // Recovery must remain available on every tier because Later
      // actions can fail on every tier; recovery is never an upsell.
      exempt: ['recovery', 'wakeRecovery'],
    },
  ];

  for (const { surface, capability, controller, gated, exempt } of SURFACES) {
    describe(surface, () => {
      it('declares the capability at class level and lists CapabilityGuard', () => {
        expect(Reflect.getMetadata(CAPABILITY_METADATA, controller)).toBe(capability);
        expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(CapabilityGuard);
      });

      it('classifies every route as gated or exempt (exhaustive)', () => {
        const routes = Object.getOwnPropertyNames(controller.prototype).filter(
          (name) => name !== 'constructor',
        );
        expect(new Set(routes)).toEqual(new Set([...gated, ...exempt]));
      });

      it('402s the free tier on every gated route', async () => {
        for (const handlerName of gated) {
          const { guard } = makeGuard('free');
          const err = await caught(
            guard.canActivate(makeCtx({ controller, handlerName, user: PRINCIPAL })),
          );
          expect(err, `${surface}.${handlerName}`).toBeInstanceOf(AppException);
          expect((err as AppException).code).toBe('PRO_FEATURE_REQUIRED');
          expect((err as AppException).getStatus()).toBe(402);
          expect((err as AppException).details).toEqual({ capability, tier: 'free' });
        }
      });

      it('402s the plus tier too (Pro set starts at pro)', async () => {
        const handlerName = gated[0]!;
        const { guard } = makeGuard('plus');
        const err = await caught(
          guard.canActivate(makeCtx({ controller, handlerName, user: PRINCIPAL })),
        );
        expect((err as AppException).code).toBe('PRO_FEATURE_REQUIRED');
      });

      it('passes pro / team / enterprise on every gated route', async () => {
        for (const tier of PRO_TIERS) {
          for (const handlerName of gated) {
            const { guard } = makeGuard(tier);
            await expect(
              guard.canActivate(makeCtx({ controller, handlerName, user: PRINCIPAL })),
              `${tier} × ${surface}.${handlerName}`,
            ).resolves.toBe(true);
          }
        }
      });

      if (exempt.length > 0) {
        it('passes the free tier on exempt routes without a tier lookup', async () => {
          for (const handlerName of exempt) {
            const { guard, tierForWorkspace } = makeGuard('free');
            await expect(
              guard.canActivate(makeCtx({ controller, handlerName, user: PRINCIPAL })),
            ).resolves.toBe(true);
            expect(tierForWorkspace).not.toHaveBeenCalled();
          }
        });
      }
    });
  }

  describe('triage (Plus capability)', () => {
    const gatedRoutes = ['scoreSender', 'queueSize', 'queue', 'todaySummary'] as const;
    const routes = ['scoreSender', 'queueSize', 'queue', 'stats', 'todaySummary'] as const;

    it('declares the capability at class level, lists the guard, and covers every route', () => {
      expect(Reflect.getMetadata(CAPABILITY_METADATA, TriageController)).toBe('triage');
      expect(Reflect.getMetadata(GUARDS_METADATA, TriageController)).toContain(CapabilityGuard);
      expect(
        Object.getOwnPropertyNames(TriageController.prototype).filter(
          (name) => name !== 'constructor',
        ),
      ).toEqual(routes);
    });

    it('402s Free and passes Plus and above on every route', async () => {
      for (const handlerName of gatedRoutes) {
        const { guard: freeGuard } = makeGuard('free');
        const err = await caught(
          freeGuard.canActivate(
            makeCtx({ controller: TriageController, handlerName, user: PRINCIPAL }),
          ),
        );
        expect(err, handlerName).toBeInstanceOf(AppException);
        expect((err as AppException).code).toBe('PRO_FEATURE_REQUIRED');
        expect((err as AppException).message).toContain('Plus plan');

        for (const tier of ['plus', 'pro', 'team', 'enterprise'] as const) {
          const { guard } = makeGuard(tier);
          await expect(
            guard.canActivate(
              makeCtx({ controller: TriageController, handlerName, user: PRINCIPAL }),
            ),
            `${tier} × triage.${handlerName}`,
          ).resolves.toBe(true);
        }
      }
    });

    it('keeps aggregate stats open for the Free onboarding practice run', async () => {
      const { guard, tierForWorkspace } = makeGuard('free');
      await expect(
        guard.canActivate(
          makeCtx({ controller: TriageController, handlerName: 'stats', user: PRINCIPAL }),
        ),
      ).resolves.toBe(true);
      expect(tierForWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('quiet hours (route-level gate on MailboxesController)', () => {
    it('gates ONLY the PUT — class stays capability-free', () => {
      expect(Reflect.getMetadata(CAPABILITY_METADATA, MailboxesController)).toBeUndefined();
      expect(
        Reflect.getMetadata(CAPABILITY_METADATA, handlerOf(MailboxesController, 'putQuietHours')),
      ).toBe('quiet');
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handlerOf(MailboxesController, 'putQuietHours')),
      ).toContain(CapabilityGuard);
    });

    it('402s free and plus on the quiet-hours PUT', async () => {
      for (const tier of UNDER_TIERS) {
        const { guard } = makeGuard(tier);
        const err = await caught(
          guard.canActivate(
            makeCtx({
              controller: MailboxesController,
              handlerName: 'putQuietHours',
              user: PRINCIPAL,
            }),
          ),
        );
        expect(err, tier).toBeInstanceOf(AppException);
        expect((err as AppException).code).toBe('PRO_FEATURE_REQUIRED');
        expect((err as AppException).details).toEqual({ capability: 'quiet', tier });
      }
    });

    it('passes pro on the quiet-hours PUT', async () => {
      const { guard } = makeGuard('pro');
      await expect(
        guard.canActivate(
          makeCtx({
            controller: MailboxesController,
            handlerName: 'putQuietHours',
            user: PRINCIPAL,
          }),
        ),
      ).resolves.toBe(true);
    });

    it('leaves the quiet-hours GET open for the free tier (pre-upgrade screen read)', async () => {
      const { guard, tierForWorkspace } = makeGuard('free');
      await expect(
        guard.canActivate(
          makeCtx({
            controller: MailboxesController,
            handlerName: 'getQuietHours',
            user: PRINCIPAL,
          }),
        ),
      ).resolves.toBe(true);
      expect(tierForWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('guard plumbing', () => {
    it('throws 401 when JwtGuard did not run first on a gated route', async () => {
      const { guard } = makeGuard('pro');
      await expect(
        guard.canActivate(
          makeCtx({ controller: BriefController, handlerName: 'today', user: undefined }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('passes unannotated routes without touching the principal or the DB', async () => {
      const { guard, tierForWorkspace } = makeGuard('free');
      await expect(
        guard.canActivate(
          makeCtx({ controller: MailboxesController, handlerName: 'list', user: undefined }),
        ),
      ).resolves.toBe(true);
      expect(tierForWorkspace).not.toHaveBeenCalled();
    });
  });
});
