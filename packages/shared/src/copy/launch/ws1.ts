/**
 * WS1 copy. The checked-in deck file is the source (drop2-r41).
 * Tokens stay in the string; formatters fill them.
 */
export const WS1_COPY = {
  'pricing.h1.passOn': 'Free to start. Pay once to clear the rest.',
  'pricing.h1.passOff': 'Free to start. Upgrade when you want more.',
  'pricing.sub': 'Unsubscribe, previews, Keep, Later and 30-day Undo are free and unlimited.',
  'pricing.meta.description':
    'Free is $0 with {allowance} emails cleared a month and unlimited unsubscribes. The {passName} is {passPrice} once. {plusName} is {plusPrice} a year. 30-day Undo on every plan.',
  'pricing.free.name': '{freeName}',
  'pricing.free.price': '$0',
  'pricing.free.tagline': 'For getting started and light upkeep',
  'pricing.free.renewal': 'No card required',
  'pricing.free.features': [
    '{allowance} emails cleared a month (Archive or Delete)',
    'Unlimited unsubscribes, Keep and Later',
    'A preview before anything moves',
    'Undo Archive, Later and Delete for 30 days',
    '{freeInboxes} {CONNECTION_TERM}',
  ],
  'pricing.free.cta': 'Start free',
  'pricing.pass.badge': 'Pay once',
  'pricing.pass.name': '{passName}',
  'pricing.pass.tagline': 'For clearing years of email in one go',
  'pricing.pass.priceSuffix': 'once',
  'pricing.pass.renewal': 'Never renews',
  'pricing.pass.features': [
    'No monthly limit for {passDays} days',
    'For one {CONNECTION_TERM}',
    'The Screener and Autopilot while it lasts',
    'Buy again any time to add {passDays} more days',
    'Then you’re back on {freeName}. Email you cleared stays where you put it.',
  ],
  'pricing.pass.features.granted': [
    'No monthly limit for {passDays} days',
    'For one {CONNECTION_TERM}',
    'The Screener and Autopilot while it lasts',
    'Then you’re back on {freeName}. Email you cleared stays where you put it.',
  ],
  'pricing.pass.cta': 'Get {passName}',
  'pricing.plus.name': '{plusName}',
  'pricing.plus.tagline': 'For staying on top of new email all year',
  'pricing.plus.priceSuffix': 'a year',
  'pricing.plus.renewal': 'Renews yearly',
  'pricing.plus.features': [
    'No monthly limit',
    'Up to {plusInboxes} {CONNECTION_TERM_PLURAL}',
    'Screener: new senders wait for your review, and their email keeps arriving',
    'Autopilot rules for new email from senders you’ve decided on',
    'Quiet hours for Autopilot',
    'Everything in {freeName}',
  ],
  'pricing.plus.cta': 'Get {plusName}',
  'pricing.features.expand': 'Show all {plusName} features',
  'pricing.features.collapse': 'Show fewer',
  'pricing.proRow': 'Need more than {plusInboxes} {CONNECTION_TERM_PLURAL}? {proName} is coming.',
  'pricing.proRow.link': 'Join the {proName} waitlist',
  'pricing.counts.title': 'What counts as an email cleared',
  'pricing.counts.body': [
    'Archiving or deleting an email you already have counts as 1 email cleared.',
    'Unsubscribe, Keep, Later, previews and Undo never count.',
    'If you undo, those emails count toward that month’s free total again.',
    'Your {freeName} total resets on your signup date each month. {BILLING_NAME} shows the date.',
  ],
  'pricing.taxes': 'Paddle, our merchant of record, handles tax. Prices in INR include GST.',
  'pricing.refundLine': '{refundDays}-day money-back on any purchase, once per customer.',
  'pricing.promo.passOn':
    'Launch offer: code {promoCode} takes {promoPercent}% off the {passName} or your first year of {plusName}, until {promoEnd}.',
  'pricing.promo.passOff':
    'Launch offer: code {promoCode} takes {promoPercent}% off your first year of {plusName}, until {promoEnd}.',
  'pricing.faq.charged.q': 'Will I be charged again?',
  'pricing.faq.charged.a':
    '{freeName} never charges you. The {passName} is a single payment and never renews. {plusName} renews once a year until you cancel, and you can cancel any time in {BILLING_NAME}.',
  'pricing.faq.charged.a.passOff':
    '{freeName} never charges you. {plusName} renews once a year until you cancel, and you can cancel any time in {BILLING_NAME}.',
  'pricing.faq.refunds.q': 'Can I get a refund?',
  'pricing.faq.refunds.a':
    'Yes. Ask within {refundDays} days of any charge and we refund it in full, once per customer. Email support@declutrmail.com with “refund” in the subject.',
  'pricing.faq.passEnds.q': 'What happens when the {passName} ends?',
  'pricing.faq.passEnds.a':
    'You’re back on {freeName}. Email you already cleared stays where you put it, and you can clear {allowance} more emails a month for free. Nothing renews, and you can buy another {passName} any time.',
  'pricing.faq.taxes.q': 'How do taxes work?',
  'pricing.faq.taxes.a':
    'Paddle is our merchant of record, so it calculates and collects any sales tax or VAT at checkout. You see the final amount before you pay.',
  'pricing.faq.india.q': 'What do you charge in India?',
  'pricing.faq.india.a':
    'In India, prices are in rupees and include GST: {plusPrice} a year for {plusName} and {passPrice} once for the {passName}.',
  'pricing.faq.india.a.paused':
    'In India, prices are in rupees and include GST: {plusPrice} a year for {plusName} and {passPrice} once for the {passName}. Buying in rupees is paused for now. Email support@declutrmail.com and we’ll help.',
  'pricing.inrPaused.notice':
    'Buying a plan in rupees is paused for now, so these prices are for reference. If you already pay in rupees, you can still manage your plan in Billing. Email support@declutrmail.com for help.',
  'pricing.inrPaused.checkout':
    'Buying a plan in rupees is paused for now. Email support@declutrmail.com for help.',
  'pricing.inrPaused.button': 'Paused for now',
  'pricing.promise.title': 'Our price promise',
  'pricing.promise.lines': [
    'If we change prices, existing subscribers keep their price for as long as they stay subscribed. If we lower a price, you get the lower price at your next renewal.',
    'The {passName} is a one-time payment and never renews.',
    'We’ll never lower the free monthly limit on an existing account.',
    '{refundDays}-day money-back on any purchase, once per customer.',
  ],
  'pricing.promise.changelogLink': 'See every price change',
  'pricing.changelog.h1': 'Pricing changelog',
  'pricing.changelog.intro': 'Every change to DeclutrMail’s prices and plans, newest first.',
  'pricing.changelog.current': 'Current launch pricing',
  'pricing.changelog.entry.2026-10-27':
    'Launch pricing: {freeName} with {allowance} emails cleared a month, {passName} {passPrice} once, {plusName} {plusPrice} a year with up to {plusInboxes} {CONNECTION_TERM_PLURAL}.',
  'pricing.teaser.cta': 'See plans',
  'refunds.toc.window': '{refundDays}-day money-back guarantee',
  'refunds.summary':
    'Every purchase comes with a {refundDays}-day money-back guarantee, once per customer. If DeclutrMail isn’t working out, tell us within {refundDays} days of being charged and we’ll refund that charge in full. You can cancel any time and keep access until the end of the period you paid for. Refunds go back to your original payment method.',
  'refunds.cancelNoRefund':
    'Canceling on its own doesn’t trigger a refund. If you also want your money back, the {refundDays}-day guarantee in Section 3 covers it.',
  'refunds.window':
    'Refund requests made within {refundDays} days of a charge (your first purchase, a renewal or a {passName}) are refunded in full. This applies to every paid plan.',
  'refunds.pass':
    'If we refund a {passName}, its {passDays} days with no monthly limit end when the refund is confirmed and your account returns to {freeName}. Email you already cleared stays where you put it.',
  'refunds.oncePerCustomer':
    'The money-back guarantee can be used once per customer. Statutory refund rights in your country (for example, EU consumer withdrawal rights) are not limited by this policy.',
  'refunds.exclusions.window':
    'Charges older than the {refundDays}-day guarantee window in Section 3, except where law requires.',
  'refunds.exclusions.second':
    'A second use of the money-back guarantee. It can be used once per customer.',
  'refunds.india':
    'New purchases in India go through Paddle, in rupees with GST included, and Paddle’s buyer terms apply. If you bought through Razorpay before, DeclutrMail is your seller: request a refund from us at support@declutrmail.com and approved refunds go back through Razorpay to your original payment method.',
  'terms.plans':
    'DeclutrMail offers a {freeName} plan, a one-time {passName}, and a yearly {plusName} subscription. Current pricing and what each plan includes are shown at purchase time. Subscriptions renew automatically until canceled; you can cancel at any time and keep access until the end of the period you paid for.',
  'terms.pass':
    'The {passName} is a one-time payment for {passDays} days with no monthly limit on one {CONNECTION_TERM}, and never renews. Buying another {passName} adds {passDays} days to the end of your current one.',
  'terms.india':
    'In India: new purchases are processed by Paddle, our merchant of record, in rupees with GST included. Subscriptions bought earlier through Razorpay continue under DeclutrMail as the seller.',
  'terms.pastDue':
    'A subscription marked past due keeps subscription access for up to 14 days after its billing period ends.',
  'meter.chip': '{remaining} emails left to clear · resets {resetDate}',
  'meter.chip.compact': '{remaining} emails left',
  'meter.chip.empty': 'No free emails left · resets {resetDate}',
  'meter.chip.aria': '{remaining} of {allowance} free emails left this month. Resets {resetDate}.',
  'meter.chip.link': 'See plans',
  'meter.preview.fits': {
    one: 'This clears 1 email. You have {remaining} free this month.',
    other: 'This clears {requested} emails. You have {remaining} free this month.',
  },
  'meter.preview.over':
    'This clears {requested} emails. You have {remaining} free left this month.',
  'meter.preview.over.one': 'This clears 1 email, but you have no free emails left this month.',
  'meter.preview.free': 'Unsubscribing is free and doesn’t count.',
  'meter.noun': {
    one: '1 email',
    other: '{n} emails',
  },
  'meter.freeAllowanceLine': 'Clear {allowance} emails a month free',
  'cap.title': 'Not enough free emails left this month',
  'cap.body':
    'This clears {requested} emails. You have {remaining} of {allowance} free emails left until {resetDate}.',
  'cap.body.zero':
    'You’ve used all {allowance} free emails this month. You get {allowance} more on {resetDate}.',
  'cap.pass.button': 'Clear all with {passName}',
  'cap.pass.sublabel': '{passPrice} once · {passDays} days, one {CONNECTION_TERM} · doesn’t renew',
  'cap.fit.button': 'Clear what fits free',
  'cap.fit.sublabel': {
    one: 'Clears 1 email older than {presetDays} days, within your free total',
    other: 'Clears {fitCount} emails older than {presetDays} days, within your free total',
  },
  'cap.fit.sublabel.noCount': 'Only emails older than {presetDays} days, within your free total',
  'cap.plus.link': 'Or get {plusName}, {plusPrice} a year: no monthly limit',
  'cap.plus.button': 'Get {plusName}',
  'cap.plus.sublabel': '{plusPrice} a year · no monthly limit',
  'cap.free.line': 'Unsubscribe, Keep, Later and Undo stay free.',
  'cap.unsubOnly': 'Unsubscribe only',
  'cap.dismiss': 'Not now',
  'cap.refund': '{refundDays}-day money-back on any purchase, once per customer.',
  'cap.api.message':
    'This needs {requested} free emails, but {remaining} of {allowance} are left this month. More on {resetDate}.',
  'cap.api.message.one':
    'This needs 1 free email, but none of your {allowance} are left this month. More on {resetDate}.',
  'cap.resumed': 'Your {passName} is active. Check the updated counts, then confirm.',
  'gate.inbox.free.title': 'Connect another {CONNECTION_TERM} with {plusName}',
  'gate.inbox.free.body':
    '{freeName} includes {freeInboxes} {CONNECTION_TERM}. {plusName} includes up to {plusInboxes}.',
  'gate.inbox.free.cta': 'Get {plusName}',
  'gate.inbox.plus.title': 'Need more than {plusInboxes} {CONNECTION_TERM_PLURAL}?',
  'gate.inbox.plus.body': '{proName} is coming, with room for more. It isn’t available to buy yet.',
  'gate.inbox.plus.cta': 'Join the {proName} waitlist',
  'gate.inbox.swap': 'To connect a different one, disconnect one first from Settings.',
  'gate.inbox.keep': 'Keep current {CONNECTION_TERM_PLURAL}',
  'gate.action.title': 'This is part of {plusName}',
  'gate.action.senderFilter':
    'Acting on every sender that matches a filter at once is part of {plusName}. On {freeName}, choose senders one at a time.',
  'gate.feature.body': '{Feature} is part of {plusName}.',
  'gate.compare': 'Compare plans',
  'picker.title': 'Choose a plan',
  'picker.current': 'Current plan',
  'picker.plus.cta': 'Get {plusName}',
  'picker.pass.cta': 'Get {passName}',
  'picker.pass.includedInPlus': 'Already included in {plusName}',
  'picker.pass.extend': 'Buy again to add {passDays} days, to {newPassEndDate}',
  'checkout.title': 'Before you pay',
  'checkout.plus.summary':
    '{plusPrice} billed yearly, starting today. Renews automatically. Cancel any time.',
  'checkout.pass.summary':
    '{passPrice} once, today. You get {passDays} days with no monthly limit on one {CONNECTION_TERM}. It doesn’t renew.',
  'checkout.taxNote': 'Taxes and the final amount are confirmed at checkout.',
  'checkout.codeNote': 'Have a code? Enter it at checkout.',
  'checkout.inr': 'Prices in INR include GST.',
  'checkout.continue': 'Continue to checkout',
  'checkout.opening': 'Opening checkout…',
  'checkout.back': 'Not now',
  'checkout.refund': '{refundDays}-day money-back on any purchase, once per customer.',
  'billing.pass.status': '{passName} · ends {passEndDate}',
  'billing.pass.statusDetail':
    'No monthly limit on one {CONNECTION_TERM}, plus the Screener and Autopilot, until {passEndDate}. Then you’re back on {freeName}. Nothing renews.',
  'billing.pass.purchased': 'Your {passName} is active until {passEndDate}.',
  'billing.pass.extended': 'Your {passName} now ends {passEndDate}.',
  'billing.plus.status': '{plusName} · renews {periodEnd}',
  'billing.free.status':
    '{freeName} · {remaining} of {allowance} free emails left · resets {resetDate}',
  'cancel.title': 'Cancel your {planName} plan?',
  'cancel.title.nonBacking': 'End your {planName} subscription?',
  'cancel.periodEnd':
    'Your {planName} features stay active until {periodEnd}. Then your account moves to {freeName}.',
  'cancel.periodEnd.unknown':
    'Your {planName} features stay active until the end of the period you paid for. Then your account moves to {freeName}.',
  'cancel.nonBacking':
    'Your {planName} subscription ends at the end of its paid period ({periodEnd}) and won’t renew.',
  'cancel.mailStays': 'Email you’ve already archived, moved or deleted stays as it is.',
  'cancel.refund':
    'Canceling stops renewal. It doesn’t refund this charge on its own. If you were charged in the last {refundDays} days, you can ask for a refund, once per customer.',
  'cancel.refundLink': 'Refund policy',
  'cancel.founding':
    'You’re on the Founding Pro price. It won’t be offered again after you cancel.',
  'cancel.pause.title': 'Pause instead?',
  'cancel.pause.body':
    'Billing and access stop right away and start again automatically after 30 days. Your senders, decisions and history stay.',
  'cancel.pause.button': 'Pause for 30 days',
  'cancel.pause.busy': 'Pausing…',
  'cancel.reason.label': 'Why are you canceling? (optional)',
  'cancel.reason.options': [
    'Prefer not to say',
    'Not using it enough',
    'Too expensive',
    'Found another tool',
    'Privacy concerns',
    'Something else',
  ],
  'cancel.confirm': 'Cancel subscription',
  'cancel.busy': 'Canceling…',
  'cancel.dismiss': 'Keep my plan',
  'cancel.dismiss.nonBacking': 'Never mind',
  'cancel.done': 'Canceled. {planName} stays active until {periodEnd}.',
  'waitlist.pro.title': '{proName} is coming',
  'waitlist.pro.body':
    '{proName} will add room for more {CONNECTION_TERM_PLURAL}, plus {BRIEF_NAME} and Follow-ups. It isn’t available to buy yet.',
  'waitlist.email.label': 'Email',
  'waitlist.email.placeholder': 'you@example.com',
  'waitlist.submit': 'Join the waitlist',
  'waitlist.busy': 'Joining…',
  'waitlist.joined': 'You’re on the {proName} waitlist.',
  'waitlist.error.invalid': 'Enter a valid email address.',
  'waitlist.error.generic': 'Couldn’t join the waitlist. Try again.',
  'waitlist.error.rateLimited': 'Too many tries. Wait a minute and try again.',
  'price.plusLine': '{plusPrice} a year',
  'price.passLine': '{passPrice} once',
  'price.inrSuffix': 'incl. GST',
  'planName.pass': 'Backlog Pass',
  'simplify.billing.confirming':
    'We’re confirming your payment. You keep your current plan meanwhile.',
  'simplify.billing.paymentReceived': 'Payment received. Your new plan will show here in a minute.',
  'simplify.billing.changeConfirming': 'We’re still confirming your plan change.',
  'simplify.billing.lastChecked': 'Last checked:',
  'simplify.billing.interrupted':
    'We’re confirming what happened with your payment. Billing changes are paused until then.',
  'simplify.billing.rupeeChanges':
    'If you pay in rupees, email support@declutrmail.com to change, pause or restart your plan. You can cancel here.',
  'simplify.billing.switchCurrency':
    'To pay in another currency, cancel first and subscribe again after your plan ends.',
  'simplify.billing.rupeeResume':
    'Restarting a plan paid in rupees could start a new charge. To avoid that, email',
  'simplify.checkout.rupeeOption': 'Prices in rupees',
  'simplify.changePlan.ifSchedulable': '…if it can be scheduled.',
  'simplify.changePlan.checking': 'Checking…',
  'simplify.changePlan.cantSchedule':
    'This change can’t keep your paid time. Try yearly or monthly instead.',
  'simplify.error.checkout': 'Couldn’t start checkout. Try again.',
  'simplify.error.restore': 'Couldn’t restore your plan. Try again.',
  'simplify.error.pause': 'Couldn’t pause your plan. Try again.',
  'simplify.error.cancel': 'Couldn’t cancel your plan. Try again.',
  'pricing.goodToKnow.free':
    '{freeName} includes all five choices. Archive and Delete count toward {allowance} emails a month, and at the limit they pause until your reset or an upgrade. Unsubscribe, Keep, Later and Undo keep working.',
  'pricing.lede.plus':
    '{plusName} adds Autopilot rules, and you see a preview before you turn one on.',
  'pr1019.pricing.lede.pro':
    'Pro adds {BRIEF_NAME}, Follow-ups, and up to {proInboxes} {CONNECTION_TERM_PLURAL}.',
  'billing.compare.choicesRow': 'Choices for each sender',
  'cap.pass.secondAccount.title': 'The {passName} covers one Gmail account',
  'cap.pass.secondAccount.body':
    'To connect another Gmail account, get {plusName}. It covers up to {plusInboxes} Gmail accounts for {plusPrice} a year.',
  'cap.pass.secondAccount.cta': 'Get {plusName}',
  'cap.pass.secondAccount.dismiss': 'Not now',
  'billing.compare.monthlyRow': 'Emails cleared a month',
  'billing.compare.accountsRow': 'Gmail accounts',
  'meter.connectedAccounts': 'connected Gmail accounts',
} as const;
