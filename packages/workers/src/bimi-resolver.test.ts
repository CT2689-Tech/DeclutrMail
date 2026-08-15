import { describe, expect, it } from 'vitest';

import {
  BIMI_MAX_BYTES,
  parseBimiRecord,
  resolveBimiIcon,
  validateBimiSvg,
  type BimiHttpPort,
  type BimiHttpResponse,
} from './bimi-resolver.js';

/**
 * BIMI resolver tests (ADR-0034).
 *
 * The SSRF guard is the reason this file exists. The `l=` URL comes
 * from a DNS record controlled by whoever owns the sender domain —
 * which includes every spammer who ever mailed a user — so each way an
 * attacker could aim our server at something it should not reach gets
 * its own case, including the redirect path (a guard that validates
 * only the first hop is not a guard).
 */

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect/></svg>';
const RECORD = 'v=BIMI1; l=https://brand.example/logo.svg; a=https://brand.example/vmc.pem';

/** An http port that answers every hop identically. */
function stubHttp(response: Partial<BimiHttpResponse>): BimiHttpPort {
  return {
    get: async () => ({
      status: 200,
      contentType: 'image/svg+xml',
      body: Buffer.from(LOGO),
      ...response,
    }),
  };
}

/** Records every URL the port was asked to dial — proves what was blocked. */
function recordingHttp(responses: BimiHttpResponse[]): BimiHttpPort & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    get: async (url) => {
      calls.push(url);
      return responses[i++] ?? { status: 404, contentType: null };
    },
  };
}

const publicHost = async () => ['93.184.216.34'];
const txt = (record: string) => async () => [[record]];

/**
 * Certificate verification is stubbed here so these cases can cover
 * record parsing, fetching and the SSRF guard without threading a cert
 * fixture through every one. The real verifier is exercised against a
 * real OpenSSL-generated chain in `vmc-verifier.test.ts`.
 */
const acceptVmc = () => ({ ok: true }) as const;
const rejectVmc = (reason: string) => () => ({ ok: false, reason }) as const;

describe('parseBimiRecord', () => {
  it('parses tags', () => {
    expect(parseBimiRecord(RECORD)).toEqual({
      v: 'BIMI1',
      l: 'https://brand.example/logo.svg',
      a: 'https://brand.example/vmc.pem',
    });
  });

  it('tolerates irregular whitespace and a trailing semicolon', () => {
    expect(parseBimiRecord('  v=BIMI1 ;   l=https://x.example/l.svg ;  ')).toEqual({
      v: 'BIMI1',
      l: 'https://x.example/l.svg',
    });
  });

  it('rejects a record that is not BIMI v1', () => {
    expect(parseBimiRecord('v=spf1 include:_spf.example')).toBeNull();
    expect(parseBimiRecord('l=https://x.example/l.svg')).toBeNull();
  });

  it('keeps the FIRST occurrence of a duplicated tag', () => {
    // A later duplicate must not overwrite: otherwise a crafted record
    // could slip a second `l=` past a reader that validated the first.
    const tags = parseBimiRecord(
      'v=BIMI1; l=https://good.example/a.svg; l=https://evil.example/b.svg',
    );
    expect(tags?.l).toBe('https://good.example/a.svg');
  });
});

describe('validateBimiSvg', () => {
  it('accepts a plain SVG Tiny PS mark', () => {
    expect(validateBimiSvg(Buffer.from(LOGO))).toEqual({ ok: true });
  });

  it.each([
    ['empty', ''],
    ['an HTML error page', '<html><body>404</body></html>'],
    ['a script element', '<svg><script>alert(1)</script></svg>'],
    ['an event handler', '<svg onload="alert(1)"><rect/></svg>'],
    ['a javascript: url', '<svg><a href="javascript:alert(1)"/></svg>'],
    ['an entity declaration', '<!ENTITY x "y"><svg><rect/></svg>'],
    ['a doctype', '<!DOCTYPE svg><svg><rect/></svg>'],
    ['a foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['an external image', '<svg><image href="https://evil.example/x.png"/></svg>'],
    ['an external use', '<svg><use href="https://evil.example/x.svg#a"/></svg>'],
    ['an external stylesheet ref', '<svg><a href="https://evil.example/x"/></svg>'],
  ])('rejects %s', (_label, content) => {
    expect(validateBimiSvg(Buffer.from(content)).ok).toBe(false);
  });

  it('rejects a mark over the byte ceiling', () => {
    const huge = Buffer.concat([
      Buffer.from('<svg>'),
      Buffer.alloc(BIMI_MAX_BYTES, 0x20),
      Buffer.from('</svg>'),
    ]);
    expect(validateBimiSvg(huge)).toEqual({ ok: false, reason: 'oversize' });
  });

  it('does not mistake ordinary attributes for event handlers', () => {
    const svg = '<svg version="1.1" viewBox="0 0 64 64"><rect fill="#000"/></svg>';
    expect(validateBimiSvg(Buffer.from(svg))).toEqual({ ok: true });
  });
});

describe('resolveBimiIcon', () => {
  it('returns the mark for a well-formed record', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: stubHttp({}),
      verifyVmc: acceptVmc,
    });

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.image.toString('utf8')).toBe(LOGO);
    expect(result.status === 'ok' && result.mime).toBe('image/svg+xml');
  });

  it('caches a miss when the domain publishes nothing', async () => {
    const result = await resolveBimiIcon('nobody.example', {
      resolveTxt: async () => {
        throw new Error('ENOTFOUND');
      },
      resolveHost: publicHost,
      http: stubHttp({}),
    });

    // The overwhelmingly common answer — and a stored one, so the
    // domain is not re-resolved on every render.
    expect(result).toEqual({ status: 'none', reason: 'no bimi record' });
  });

  it('respects a record that declines to publish a logo', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt('v=BIMI1; l=; a='),
      resolveHost: publicHost,
      http: stubHttp({}),
    });

    expect(result).toEqual({ status: 'none', reason: 'record declines a logo' });
  });

  it('requires the vmc tag to be present', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt('v=BIMI1; l=https://brand.example/logo.svg'),
      resolveHost: publicHost,
      http: stubHttp({}),
    });

    expect(result).toEqual({ status: 'none', reason: 'record carries no vmc tag' });
  });

  describe('SSRF guard', () => {
    it.each([
      ['loopback', '127.0.0.1'],
      ['RFC 1918', '10.0.0.5'],
      ['RFC 1918 (172.16/12)', '172.20.1.1'],
      ['RFC 1918 (192.168/16)', '192.168.1.1'],
      ['cloud metadata link-local', '169.254.169.254'],
      ['CGNAT', '100.100.0.1'],
      ['IPv4-mapped IPv6 private', '::ffff:10.0.0.5'],
      ['IPv6 loopback', '::1'],
      ['IPv6 unique-local', 'fd00::1'],
      ['IPv6 link-local', 'fe80::1'],
    ])('refuses a logo url resolving to %s', async (_label, address) => {
      const http = recordingHttp([]);
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt(RECORD),
        resolveHost: async () => [address],
        http,
      });

      expect(result).toEqual({ status: 'none', reason: 'private target' });
      // The point: nothing was dialed at all.
      expect(http.calls).toEqual([]);
    });

    it('refuses when ANY resolved address is private', async () => {
      // A hostile resolver returning one public and one private address
      // must not pass on the strength of the public one.
      const http = recordingHttp([]);
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt(RECORD),
        resolveHost: async () => ['93.184.216.34', '169.254.169.254'],
        http,
      });

      expect(result).toEqual({ status: 'none', reason: 'private target' });
      expect(http.calls).toEqual([]);
    });

    it('refuses a non-https logo url', async () => {
      const http = recordingHttp([]);
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt('v=BIMI1; l=http://brand.example/logo.svg; a=https://x.example/v.pem'),
        resolveHost: publicHost,
        http,
      });

      expect(result).toEqual({ status: 'none', reason: 'insecure scheme' });
      expect(http.calls).toEqual([]);
    });

    it('refuses a url carrying credentials', async () => {
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt('v=BIMI1; l=https://u:p@brand.example/l.svg; a=https://x.example/v.pem'),
        resolveHost: publicHost,
        http: stubHttp({}),
      });

      expect(result).toEqual({ status: 'none', reason: 'url carries credentials' });
    });

    it('re-runs the guard on every redirect hop', async () => {
      // The hop that matters: a public first URL redirecting at the
      // metadata service. A guard that only validated the first URL
      // would fetch it.
      const http = recordingHttp([
        { status: 302, contentType: null, location: 'https://internal.example/' },
      ]);
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt(RECORD),
        resolveHost: async (hostname) =>
          hostname === 'internal.example' ? ['169.254.169.254'] : ['93.184.216.34'],
        http,
      });

      expect(result).toEqual({ status: 'none', reason: 'private target' });
      // Hop 1 was dialed; the redirect target never was.
      expect(http.calls).toEqual(['https://brand.example/logo.svg']);
    });

    it('follows a redirect to a public target', async () => {
      const http = recordingHttp([
        { status: 301, contentType: null, location: 'https://cdn.example/logo.svg' },
        { status: 200, contentType: 'image/svg+xml', body: Buffer.from(LOGO) },
        // The VMC fetch that follows the logo.
        { status: 200, contentType: 'application/pkix-cert', body: Buffer.from('PEM') },
      ]);
      const result = await resolveBimiIcon('brand.example', {
        resolveTxt: txt(RECORD),
        resolveHost: publicHost,
        http,
        verifyVmc: acceptVmc,
      });

      expect(result.status).toBe('ok');
      expect(http.calls).toEqual([
        'https://brand.example/logo.svg',
        'https://cdn.example/logo.svg',
        'https://brand.example/vmc.pem',
      ]);
    });

    it('gives up inside the redirect budget', async () => {
      const hop = {
        status: 302,
        contentType: null,
        location: 'https://brand.example/again.svg',
      };
      const http = recordingHttp([hop, hop, hop, hop]);
      const result = await resolveBimiIcon('brand.example', {
        resolveTxt: txt(RECORD),
        resolveHost: publicHost,
        http,
      });

      expect(result).toEqual({ status: 'none', reason: 'too many redirects' });
      expect(http.calls.length).toBeLessThanOrEqual(3);
    });
  });

  it('rejects a non-SVG content type', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: stubHttp({ contentType: 'text/html', body: Buffer.from('<html/>') }),
    });

    expect(result).toEqual({ status: 'none', reason: 'unexpected content-type: text/html' });
  });

  it('accepts a content type carrying parameters', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: stubHttp({ contentType: 'image/svg+xml; charset=utf-8' }),
      verifyVmc: acceptVmc,
    });

    expect(result.status).toBe('ok');
  });

  it('rejects a body abandoned at the byte ceiling', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: { get: async () => ({ status: 200, contentType: 'image/svg+xml', tooLarge: true }) },
    });

    expect(result).toEqual({ status: 'none', reason: 'oversize' });
  });

  it('rejects a scripted SVG served with an honest content type', async () => {
    const result = await resolveBimiIcon('evil.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: stubHttp({ body: Buffer.from('<svg><script>alert(1)</script></svg>') }),
    });

    expect(result.status).toBe('none');
    expect(result.status === 'none' && result.reason).toMatch(/script/);
  });

  it('reports a non-200 as a miss rather than throwing', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: { get: async () => ({ status: 404, contentType: null }) },
    });

    expect(result).toEqual({ status: 'none', reason: 'http 404' });
  });

  describe('VMC verification', () => {
    it('stores nothing when the certificate does not verify', async () => {
      // The whole point of Phase 2: a well-formed record serving real
      // SVG still yields no logo unless the cert stands behind it.
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt(RECORD),
        resolveHost: publicHost,
        http: stubHttp({}),
        verifyVmc: rejectVmc('vmc: certificate does not commit to this logo'),
      });

      expect(result).toEqual({
        status: 'none',
        reason: 'vmc: certificate does not commit to this logo',
      });
    });

    it('hands the verifier the domain and the exact bytes being served', async () => {
      const seen: Array<{ domain: string; logo: string; pem: string }> = [];
      await resolveBimiIcon('brand.example', {
        resolveTxt: txt(RECORD),
        resolveHost: publicHost,
        http: stubHttp({}),
        verifyVmc: (opts) => {
          seen.push({ domain: opts.domain, logo: opts.logo.toString('utf8'), pem: opts.pem });
          return { ok: true };
        },
      });

      // Verifying against anything other than the bytes we are about to
      // store would make the check theatre.
      expect(seen).toEqual([{ domain: 'brand.example', logo: LOGO, pem: LOGO }]);
    });

    it('fetches the certificate through the SSRF guard too', async () => {
      // The `a=` URL comes from the same attacker-controlled record as
      // `l=`, so it gets the same treatment — including redirects.
      const http = recordingHttp([
        { status: 200, contentType: 'image/svg+xml', body: Buffer.from(LOGO) },
      ]);
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt('v=BIMI1; l=https://brand.example/l.svg; a=http://brand.example/vmc.pem'),
        resolveHost: publicHost,
        http,
        verifyVmc: acceptVmc,
      });

      expect(result).toEqual({ status: 'none', reason: 'vmc fetch: insecure scheme' });
      // The logo was fetched; the plain-http cert URL never was.
      expect(http.calls).toEqual(['https://brand.example/l.svg']);
    });

    it('refuses a certificate url pointed at a private address', async () => {
      const http = recordingHttp([
        { status: 200, contentType: 'image/svg+xml', body: Buffer.from(LOGO) },
      ]);
      const result = await resolveBimiIcon('evil.example', {
        resolveTxt: txt('v=BIMI1; l=https://cdn.example/l.svg; a=https://internal.example/v.pem'),
        resolveHost: async (host) =>
          host === 'internal.example' ? ['169.254.169.254'] : ['93.184.216.34'],
        http,
        verifyVmc: acceptVmc,
      });

      expect(result).toEqual({ status: 'none', reason: 'vmc fetch: private target' });
      expect(http.calls).toEqual(['https://cdn.example/l.svg']);
    });

    it('accepts whatever content type the issuer serves the PEM as', async () => {
      // Issuers serve PEM as application/pkix-cert, x-pem-file, or
      // text/plain. The bytes are validated by parsing them as X.509,
      // which beats trusting a header.
      const http = recordingHttp([
        { status: 200, contentType: 'image/svg+xml', body: Buffer.from(LOGO) },
        { status: 200, contentType: 'text/plain', body: Buffer.from('PEM') },
      ]);
      const result = await resolveBimiIcon('brand.example', {
        resolveTxt: txt(RECORD),
        resolveHost: publicHost,
        http,
        verifyVmc: acceptVmc,
      });

      expect(result.status).toBe('ok');
    });
  });

  it('reports a transport failure as a miss rather than throwing', async () => {
    const result = await resolveBimiIcon('brand.example', {
      resolveTxt: txt(RECORD),
      resolveHost: publicHost,
      http: {
        get: async () => {
          throw new Error('ECONNRESET');
        },
      },
    });

    expect(result).toEqual({ status: 'none', reason: 'fetch failed' });
  });
});
