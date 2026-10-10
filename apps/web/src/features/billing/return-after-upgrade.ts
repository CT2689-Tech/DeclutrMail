import { parseUpgradeReturnTo } from '@declutrmail/shared/contracts/app-navigation';

/** Called only after the existing paid-subscription confirmation succeeds. */
export function returnAfterUpgrade(value: string | undefined): void {
  const destination = parseUpgradeReturnTo(value);
  if (destination) window.location.assign(destination);
}
