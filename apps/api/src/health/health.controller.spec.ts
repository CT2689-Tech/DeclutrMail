import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('exposes a dependency-free GET /healthz liveness contract', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe('healthz');
    expect(Reflect.getMetadata(PATH_METADATA, HealthController.prototype.getHealth)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, HealthController.prototype.getHealth)).toBe(
      RequestMethod.GET,
    );

    expect(new HealthController().getHealth()).toEqual({ status: 'ok' });
  });
});
