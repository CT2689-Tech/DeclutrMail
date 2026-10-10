/** Routes that may survive authentication; these are destinations, never authorization. */
const APP_PATHS = [
  '/home',
  '/senders',
  '/triage',
  '/activity',
  '/autopilot',
  '/later',
  '/brief',
  '/followups',
  '/screener',
  '/quiet',
  '/settings',
  '/settings/privacy',
  '/settings/help',
  '/settings/senders',
  '/billing',
  '/onboarding',
  '/admin/security',
];

export { isUserScopedAppPath } from './account-navigation.js';

/** Preserve a known local app destination without admitting hosts or normalized path tricks. */
export function parseAppReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  )
    return undefined;
  let url: URL;
  try {
    url = new URL(value, 'https://declutrmail.invalid');
  } catch {
    return undefined;
  }
  const rawPath = value.split(/[?#]/, 1)[0];
  if (url.origin !== 'https://declutrmail.invalid' || url.pathname !== rawPath) return undefined;
  if (!APP_PATHS.includes(url.pathname) && !/^\/senders\/[a-zA-Z0-9_-]+$/.test(url.pathname))
    return undefined;
  if (
    url.hash &&
    (url.pathname !== '/settings' ||
      !/^#(?:account|mailboxes|mailbox-[a-zA-Z0-9_-]+)$/.test(url.hash))
  )
    return undefined;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return undefined;
  if (url.pathname === '/billing') {
    if (keys.some((key) => !['plan', 'cycle', 'promo', 'from'].includes(key))) return undefined;
    const plan = url.searchParams.get('plan');
    const cycle = url.searchParams.get('cycle');
    const promo = url.searchParams.get('promo');
    if (
      (plan !== null || cycle !== null || promo !== null) &&
      ((plan !== 'plus' && plan !== 'pro') || (cycle !== 'monthly' && cycle !== 'annual'))
    )
      return undefined;
    if (promo !== null && (promo !== 'foundingPro' || plan !== 'pro' || cycle !== 'annual'))
      return undefined;
    const from = url.searchParams.get('from');
    // An upgrade returns to work, never another checkout (or another nested intent).
    if (from !== null && !parseUpgradeReturnTo(from)) return undefined;
    const query = new URLSearchParams();
    if (plan !== null && cycle !== null) {
      query.set('plan', plan);
      query.set('cycle', cycle);
    }
    if (promo !== null) query.set('promo', promo);
    if (from !== null) query.set('from', from);
    return query.size ? `/billing?${query}` : '/billing';
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Avoid nested checkout loops in upgrade links. */
export function parseUpgradeReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.split(/[?#]/, 1)[0] === '/billing' ||
    new URLSearchParams(value.split('?')[1]?.split('#')[0]).has('from')
  )
    return undefined;
  return parseAppReturnTo(value);
}
