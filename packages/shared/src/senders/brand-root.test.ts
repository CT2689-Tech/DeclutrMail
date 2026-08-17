import { describe, expect, it } from 'vitest';

import { organizationalDomain } from './organizational-domain';

describe('organizationalDomain', () => {
  it('collapses arbitrary mailing subdomains to the registrable brand domain', () => {
    expect(organizationalDomain('alertsp.chase.com')).toBe('chase.com');
    expect(organizationalDomain('rs.email.nextdoor.com')).toBe('nextdoor.com');
    expect(organizationalDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(organizationalDomain('shop.myer.com.au')).toBe('myer.com.au');
  });

  it('does not merge unrelated tenants on private public suffixes', () => {
    expect(organizationalDomain('mail.acme.github.io')).toBe('acme.github.io');
    expect(organizationalDomain('news.brand.blogspot.com')).toBe('brand.blogspot.com');
  });
});
