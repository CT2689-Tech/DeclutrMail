/**
 * WS1 copy from the launch deck (drop2-r7, 2026-10-11).
 * Tokens stay in the string; formatters fill them from config.
 */
export const WS1_COPY = {
  'meter.noun.one': '1 email',
  'meter.noun.other': '{n} emails',
  'meter.freeAllowanceLine': 'Clear {allowance} emails a month free',
  'meter.chip': '{remaining} of {allowance} free emails left \u00b7 resets {resetDate}',
  'meter.chip.compact': '{remaining} of {allowance} left',
  'meter.chip.empty': 'No free emails left \u00b7 resets {resetDate}',
  'meter.chip.aria': '{remaining} of {allowance} free emails left this month. Resets {resetDate}.',
  'meter.preview.fits.one': 'This clears 1 email. You have {remaining} free this month.',
  'meter.preview.fits.other':
    'This clears {requested} emails. You have {remaining} free this month.',
  'meter.preview.over':
    'This clears {requested} emails. You have {remaining} free left this month.',
  'meter.preview.free': 'Unsubscribing is free and doesn\u2019t count.',
  'pricing.refundLine': '{refundDays}-day money-back on any purchase, once per customer.',
  'pricing.promise.keep':
    'If we change prices, existing subscribers keep their price for as long as they stay subscribed. If we lower a price, you get the lower price at your next renewal.',
  'pricing.promise.pass': 'The {passName} is a one-time payment and never renews.',
  'pricing.promise.free': 'We\u2019ll never lower the free monthly limit on an existing account.',
  'planName.pass': 'Backlog Pass',
  'price.inrSuffix': 'incl. GST',
  'price.plusLine': '{plusPrice} a year',
  'gate.inbox.free.title': 'Connect another {CONNECTION_TERM} with {plusName}',
  'gate.inbox.free.body':
    '{freeName} includes {freeInboxes} {CONNECTION_TERM}. {plusName} includes up to {plusInboxes}.',
  'gate.inbox.free.cta': 'Get {plusName}',
  'gate.inbox.plus.title': 'Need more than {plusInboxes} {CONNECTION_TERM_PLURAL}?',
  'gate.inbox.plus.body':
    '{proName} is coming, with room for more. It isn\u2019t available to buy yet.',
  'gate.inbox.plus.cta': 'Join the {proName} waitlist',
  'waitlist.joined': 'You\u2019re on the {proName} waitlist.',
  'cap.api.message':
    'This needs {requested} free emails, but {remaining} of {allowance} are left this month. More on {resetDate}.',
  'cap.title': 'Not enough free emails left this month',
  'cap.fit.button': 'Clear what fits free',
  'cap.plus.button': 'Get {plusName}',
  'cap.dismiss': 'Not now',
  'cancel.founding':
    'You\u2019re on the Founding Pro price. It won\u2019t be offered again after you cancel.',
} as const;
