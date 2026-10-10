import { parseAppReturnTo } from '@declutrmail/shared/contracts/app-navigation';

/** Loaded only after a terminal 401; the caller owns the safe fallback. */
export function returningSignInPath(): string {
  const returnTo = parseAppReturnTo(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  return `/sign-in?${new URLSearchParams({ returning: '1', ...(returnTo ? { returnTo } : {}) })}`;
}
