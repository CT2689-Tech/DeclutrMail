import { describe, expect, it } from 'vitest';

import { hasLegalEntity, LEGAL_ENTITY_ADDRESS, LEGAL_ENTITY_NAME } from './legal-entity';
import {
  BACKLOG_PASS_NAME,
  BILLING_NAME,
  BRIEF_NAME,
  CATCH_UP_GROUP,
  CATCH_UP_LATER_FIRST,
  CONNECTION_TERM,
  FINISH_LABEL,
  FIRST_LANDING_SLOT_ORDER,
  HOME_NEXT_STEPS_LABEL,
  KICKER_STYLE,
  LOCKED_PLUS_PRIMARY,
  NAV_GROUP_LABEL,
  PRO_PURCHASABLE,
  PRO_WAITLIST_CONTACT_PROMISE,
  PROVIDER_WAITLIST_CONTACT,
  REPORT_TRUST_LINE_WRITTEN_TO,
  SCREENER_NAME,
  SETTINGS_BRIEF_CARD,
  SETTINGS_PREVIEWS_TITLE,
  SHOW_SCREENER_NEW_SENDER_COUNT_FREE,
  SHOW_SWEEPER_VENDOR_NAME,
  TRIAGE_NAME,
} from './screen-decisions';

describe('screen decision defaults', () => {
  it('ships the launch defaults', () => {
    expect(NAV_GROUP_LABEL).toBe('Cleanup');
    expect(CONNECTION_TERM).toBe('Gmail account');
    expect(BRIEF_NAME).toBe('Daily Brief');
    expect(BILLING_NAME).toBe('Plan & billing');
    expect(KICKER_STYLE).toBe('group_only');
    expect(PRO_WAITLIST_CONTACT_PROMISE).toBe(false);
    expect(SETTINGS_BRIEF_CARD).toBe('hide');
    expect(LOCKED_PLUS_PRIMARY).toBe('plus');
    expect(HOME_NEXT_STEPS_LABEL).toBe('Suggested next steps');
    expect(FINISH_LABEL).toBe('Finish review');
    expect(TRIAGE_NAME).toBe('Triage');
    expect(SCREENER_NAME).toBe('Screener');
    expect(BACKLOG_PASS_NAME).toBe('Backlog Pass');
    expect(CATCH_UP_GROUP).toBe('keep');
    expect(SETTINGS_PREVIEWS_TITLE).toBe('Preview layout');
    expect(REPORT_TRUST_LINE_WRITTEN_TO).toBe(true);
    expect(PRO_PURCHASABLE).toBe(false);
    expect(CATCH_UP_LATER_FIRST).toBe(true);
    expect(FIRST_LANDING_SLOT_ORDER).toEqual([
      'inbox_report',
      'first_backlog_header',
      'first_cleanup_nudge',
    ]);
    expect(SHOW_SCREENER_NEW_SENDER_COUNT_FREE).toBe(true);
    expect(SHOW_SWEEPER_VENDOR_NAME).toBe(true);
    expect(PROVIDER_WAITLIST_CONTACT).toBe('opt_in');
  });
});

describe('legal entity', () => {
  it('has no placeholder and is present only when both lines are set', () => {
    expect(LEGAL_ENTITY_NAME).not.toContain('FILL_ME');
    expect(LEGAL_ENTITY_ADDRESS).not.toContain('FILL_ME');
    expect(hasLegalEntity()).toBe(
      LEGAL_ENTITY_NAME.trim() !== '' && LEGAL_ENTITY_ADDRESS.trim() !== '',
    );
  });
});
