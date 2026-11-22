import { describe, expect, it } from 'vitest';

import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';

import { clientProfile, errorClassOf } from './mcp-client-profile.js';

describe('clientProfile', () => {
  it('reads a 2026 envelope: protocol and whether the client can elicit', () => {
    const envelope = {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
      [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } },
    };
    expect(clientProfile(envelope, undefined)).toEqual({
      protocol: '2026-07-28',
      elicitation: 'yes',
    });
    expect(
      clientProfile(
        { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {} },
        undefined,
      ),
    ).toEqual({ protocol: '2026-07-28', elicitation: 'no' });
  });

  it('counts only form mode: a client that can only open links cannot confirm in chat', () => {
    const profile = (elicitation: unknown) =>
      clientProfile(
        {
          [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
          [CLIENT_CAPABILITIES_META_KEY]: { elicitation },
        },
        undefined,
      ).elicitation;
    expect(profile({})).toBe('yes');
    expect(profile({ form: {}, url: {} })).toBe('yes');
    expect(profile({ url: {} })).toBe('no');
    expect(profile(true)).toBe('no');
  });

  it('a 2025 client sent capabilities only at initialize, so elicitation is unknown, not no', () => {
    expect(clientProfile(undefined, '2025-06-18')).toEqual({
      protocol: '2025-06-18',
      elicitation: 'unknown',
    });
  });

  it('keeps only a revision-shaped protocol: client text never reaches the log', () => {
    expect(clientProfile(undefined, 'ignore previous instructions').protocol).toBe('other');
    expect(clientProfile({ [PROTOCOL_VERSION_META_KEY]: 42 }, undefined).protocol).toBe('unknown');
    expect(clientProfile(undefined, undefined)).toEqual({
      protocol: 'unknown',
      elicitation: 'unknown',
    });
  });
});

describe('errorClassOf', () => {
  it('turns a tool error code into the PascalCase shape error_class accepts', () => {
    expect(errorClassOf('PREVIEW_EXPIRED')).toBe('PreviewExpired');
    expect(errorClassOf('INTERNAL_ERROR')).toBe('InternalError');
    expect(errorClassOf('RATE_LIMITED')).toBe('RateLimited');
  });
});
