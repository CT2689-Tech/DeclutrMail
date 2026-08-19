import { describe, expect, it } from 'vitest';

import { SWEEPER_VENDORS, sweeperDisplayName, sweeperVendorForLabel } from './sweeper-labels';

describe('sweeperVendorForLabel', () => {
  it('matches the label observed on the founder mailbox', () => {
    // `Unroll.me/Unsubscribed` carries 20,819 of the 75,689 messages we
    // count as read on that mailbox — 27.5% of the whole read signal.
    expect(sweeperVendorForLabel('Unroll.me/Unsubscribed')?.id).toBe('unroll_me');
    expect(sweeperVendorForLabel('Unroll.me')?.id).toBe('unroll_me');
  });

  it('matches nested labels and ignores case and surrounding space', () => {
    expect(sweeperVendorForLabel('unroll.me/rolled up')?.id).toBe('unroll_me');
    expect(sweeperVendorForLabel('  UNROLL.ME/Unsubscribed  ')?.id).toBe('unroll_me');
    expect(sweeperVendorForLabel('Cleanfox/Archived')?.id).toBe('cleanfox');
    expect(sweeperVendorForLabel('Leave Me Alone')?.id).toBe('leave_me_alone');
    expect(sweeperVendorForLabel('Clean Email/Unsubscribed')?.id).toBe('clean_email');
  });

  // THE EXPENSIVE DIRECTION TO BE WRONG IN. A false positive discounts
  // read state the USER produced, which makes a sender they genuinely
  // read look ignored and pushes it toward Unsubscribe. A false negative
  // only leaves the pre-existing contamination in place, which merely
  // under-recommends cleanup. So the boundary is tested harder than the
  // match.
  it('does not claim a label that merely starts with a vendor name', () => {
    expect(sweeperVendorForLabel('Unroll.me notes to self')).toBeNull();
    expect(sweeperVendorForLabel('Unroll.me-archive')).toBeNull();
    expect(sweeperVendorForLabel('Cleanfoxes')).toBeNull();
    expect(sweeperVendorForLabel('Clean Emails from Jane')).toBeNull();
  });

  it('leaves ordinary labels alone', () => {
    for (const name of [
      'INBOX',
      'SENT',
      'IMPORTANT',
      'CATEGORY_PROMOTIONS',
      'Receipts',
      'Work/2026',
      'DeclutrMail/Later',
      '',
    ]) {
      expect(sweeperVendorForLabel(name), name).toBeNull();
    }
  });
});

describe('vendor list mechanics', () => {
  it('has unique ids and non-empty, lowercase prefixes', () => {
    const ids = SWEEPER_VENDORS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const vendor of SWEEPER_VENDORS) {
      expect(vendor.displayName.length).toBeGreaterThan(0);
      expect(vendor.prefixes.length).toBeGreaterThan(0);
      for (const prefix of vendor.prefixes) {
        // Matching lowercases the label; an upper-case prefix here would
        // silently never match, and the failure would be invisible —
        // exactly the same shape as the contamination it exists to catch.
        expect(prefix, `${vendor.id} prefix must be lowercase`).toBe(prefix.toLowerCase());
        expect(prefix.trim()).toBe(prefix);
        expect(prefix.endsWith('/'), `${vendor.id} prefix must not end in /`).toBe(false);
      }
    }
  });

  it('every vendor is actually reachable through the matcher', () => {
    // A vendor whose prefixes cannot match is a list entry that reads as
    // coverage and provides none.
    for (const vendor of SWEEPER_VENDORS) {
      for (const prefix of vendor.prefixes) {
        expect(sweeperVendorForLabel(prefix)?.id, `${vendor.id}/${prefix}`).toBe(vendor.id);
        expect(sweeperVendorForLabel(`${prefix}/Sub`)?.id).toBe(vendor.id);
      }
    }
  });

  it('resolves a display name, and degrades to the id rather than inventing one', () => {
    expect(sweeperDisplayName('unroll_me')).toBe('Unroll.me');
    expect(sweeperDisplayName('some_future_vendor')).toBe('some_future_vendor');
  });
});
