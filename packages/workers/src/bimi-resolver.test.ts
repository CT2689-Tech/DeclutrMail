import { describe, expect, it } from 'vitest';

import {
  BIMI_MAX_BYTES,
  bimiLookupCandidates,
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
    ['a filter image', '<svg><feImage href="relative.png"/></svg>'],
    ['an external use', '<svg><use href="https://evil.example/x.svg#a"/></svg>'],
    ['an external stylesheet ref', '<svg><a href="https://evil.example/x"/></svg>'],
    ['a stylesheet import', '<svg><style>@import "https://evil.example/x.css";</style></svg>'],
    ['an external CSS URL', '<svg><rect style="fill:url(https://evil.example/x.svg)"/></svg>'],
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

  it('does not mistake ordinary attributes or local paint references for active content', () => {
    const svg =
      '<svg version="1.1" viewBox="0 0 64 64"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>';
    expect(validateBimiSvg(Buffer.from(svg))).toEqual({ ok: true });
  });
});

describe('bimiLookupCandidates', () => {
  it('walks ancestors down to a two-label name', () => {
    expect(bimiLookupCandidates('info.asics.com')).toEqual(['info.asics.com', 'asics.com']);
    expect(bimiLookupCandidates('brand.com')).toEqual(['brand.com']);
  });

  it('does not need a public-suffix list', () => {
    // `co.uk` is queried and that is fine: a record there still has to
    // present a VMC whose SAN covers `co.uk` from a BIMI-authorised CA.
    // The certificate, not DNS, decides what gets rendered.
    expect(bimiLookupCandidates('mail.brand.co.uk')).toEqual([
      'mail.brand.co.uk',
      'brand.co.uk',
      'co.uk',
    ]);
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

  /**
   * The gap that made this feature render almost nothing in
   * production: bulk senders mail from `member.`/`official.`/`info.`
   * subdomains and publish BIMI at the brand. Verified against live
   * DNS 2026-08-16 — `member.americanexpress.com` and
   * `official.asos.com` are NXDOMAIN while their parents both answer.
   */
  describe('organizational-domain fallback', () => {
    /** TXT seam answering per NAME; anything unlisted is NXDOMAIN. */
    function txtZone(zone: Record<string, string>) {
      return async (name: string): Promise<string[][]> => {
        const record = zone[name];
        if (record === undefined) {
          throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
        }
        return [[record]];
      };
    }

    it('falls back to the parent when the mailing subdomain publishes nothing', async () => {
      const result = await resolveBimiIcon('member.americanexpress.example', {
        resolveTxt: txtZone({ 'default._bimi.americanexpress.example': RECORD }),
        resolveHost: publicHost,
        http: stubHttp({}),
        verifyVmc: acceptVmc,
      });

      expect(result.status).toBe('ok');
    });

    it('checks the certificate against the domain the record came from', async () => {
      const seen: string[] = [];
      await resolveBimiIcon('member.americanexpress.example', {
        resolveTxt: txtZone({ 'default._bimi.americanexpress.example': RECORD }),
        resolveHost: publicHost,
        http: stubHttp({}),
        verifyVmc: (opts) => {
          seen.push(opts.domain);
          return { ok: true };
        },
      });

      // A brand's VMC carries the BRAND's SAN. Verifying the parent's
      // record against the subdomain we happened to start from would
      // fail every fallback and quietly undo this whole path.
      expect(seen).toEqual(['americanexpress.example']);
    });

    it('walks every ancestor, most specific first', async () => {
      const asked: string[] = [];
      await resolveBimiIcon('a.b.brand.example', {
        resolveTxt: async (name) => {
          asked.push(name);
          throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        },
        resolveHost: publicHost,
        http: stubHttp({}),
      });

      expect(asked).toEqual([
        'default._bimi.a.b.brand.example',
        'default._bimi.b.brand.example',
        'default._bimi.brand.example',
      ]);
    });

    it('prefers the subdomain record over the parent', async () => {
      const seen: string[] = [];
      await resolveBimiIcon('reply.ebay.example', {
        resolveTxt: txtZone({
          'default._bimi.reply.ebay.example': RECORD,
          'default._bimi.ebay.example': RECORD,
        }),
        resolveHost: publicHost,
        http: stubHttp({}),
        verifyVmc: (opts) => {
          seen.push(opts.domain);
          return { ok: true };
        },
      });

      expect(seen).toEqual(['reply.ebay.example']);
    });

    it('respects a subdomain that declines a logo instead of asking the parent', async () => {
      const result = await resolveBimiIcon('quiet.brand.example', {
        resolveTxt: txtZone({
          'default._bimi.quiet.brand.example': 'v=BIMI1; l=; a=',
          'default._bimi.brand.example': RECORD,
        }),
        resolveHost: publicHost,
        http: stubHttp({}),
        verifyVmc: acceptVmc,
      });

      // "No mark for this subdomain" is an answer, not a referral.
      expect(result).toEqual({ status: 'none', reason: 'record declines a logo' });
    });

    it('still throws on a resolver outage rather than walking past it', async () => {
      // Otherwise one DNS blip is written as a 30-day cached miss.
      await expect(
        resolveBimiIcon('member.brand.example', {
          resolveTxt: async () => {
            throw Object.assign(new Error('SERVFAIL'), { code: 'SERVFAIL' });
          },
          resolveHost: publicHost,
          http: stubHttp({}),
        }),
      ).rejects.toThrow(/BIMI DNS lookup failed/);
    });
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

  it.each([408, 425, 429, 500, 503])(
    'retries a transient HTTP %s instead of caching or downgrading the mark',
    async (status) => {
      await expect(
        resolveBimiIcon('brand.example', {
          resolveTxt: txt(RECORD),
          resolveHost: publicHost,
          http: { get: async () => ({ status, contentType: null }) },
        }),
      ).rejects.toThrow(new RegExp(`HTTP ${status}`));
    },
  );

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

  describe('transient faults are not cached as misses', () => {
    // The distinction that matters: NXDOMAIN is an ANSWER (store it,
    // that is the negative cache working), a resolver or socket
    // outage is not. Swallowing the latter writes a 30-day cached miss
    // over a blip and never engages batchPolicy's retry budget,
    // because processJob would have returned normally.
    const dnsError = (code: string) => Object.assign(new Error(code), { code });

    it.each(['SERVFAIL', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEOUT'])(
      'rethrows a %s DNS failure so the job retries',
      async (code) => {
        await expect(
          resolveBimiIcon('brand.example', {
            resolveTxt: async () => {
              throw dnsError(code);
            },
            resolveHost: publicHost,
            http: stubHttp({}),
            verifyVmc: acceptVmc,
          }),
        ).rejects.toThrow(/DNS lookup failed/);
      },
    );

    it('still caches NXDOMAIN as a miss', async () => {
      const result = await resolveBimiIcon('nobody.example', {
        resolveTxt: async () => {
          throw dnsError('ENOTFOUND');
        },
        resolveHost: publicHost,
        http: stubHttp({}),
      });

      expect(result).toEqual({ status: 'none', reason: 'no bimi record' });
    });

    it('rethrows a socket failure while fetching the logo', async () => {
      await expect(
        resolveBimiIcon('brand.example', {
          resolveTxt: txt(RECORD),
          resolveHost: publicHost,
          http: {
            get: async () => {
              throw new Error('ECONNRESET');
            },
          },
          verifyVmc: acceptVmc,
        }),
      ).rejects.toThrow(/fetch failed/);
    });

    it('rethrows a transient host lookup failure', async () => {
      await expect(
        resolveBimiIcon('brand.example', {
          resolveTxt: txt(RECORD),
          resolveHost: async () => {
            throw dnsError('SERVFAIL');
          },
          http: stubHttp({}),
          verifyVmc: acceptVmc,
        }),
      ).rejects.toThrow(/host lookup failed/);
    });

    it('still treats a genuinely dead hostname as a miss', async () => {
      // The published URL points at a name that does not exist — a
      // real fact about the record, not an outage.
      const result = await resolveBimiIcon('brand.example', {
        resolveTxt: txt(RECORD),
        resolveHost: async () => {
          throw dnsError('ENOTFOUND');
        },
        http: stubHttp({}),
        verifyVmc: acceptVmc,
      });

      expect(result).toEqual({ status: 'none', reason: 'dns failure' });
    });
  });
});
