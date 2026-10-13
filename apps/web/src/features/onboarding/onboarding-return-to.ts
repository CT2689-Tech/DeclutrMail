import { parseAppReturnTo } from '@declutrmail/shared/contracts/app-navigation';
import {
  connectStartResultOf,
  oauthResultIn,
  OAUTH_RESULT_PARAMS,
} from '@/features/mailboxes/oauth-result';

/**
 * Where the onboarding gate sends someone who has not finished onboarding,
 * keeping a closed OAuth result so /onboarding can still say what happened.
 * The validated destination survives; one-shot OAuth results are removed from it.
 */
export function onboardingPathKeepingOAuthResult(search: string, destination?: string): string {
  const result = oauthResultIn(search);
  const params = new URLSearchParams(search);
  const passSecondAccount =
    !result && connectStartResultOf(params.get('connect_start_result')) === 'pass_second_account';
  const safeDestination = parseAppReturnTo(destination ?? params.get('returnTo'));
  const target = safeDestination ? new URL(safeDestination, 'https://declutrmail.invalid') : null;
  for (const key of OAUTH_RESULT_PARAMS) target?.searchParams.delete(key);
  const returnTo = target ? `${target.pathname}${target.search}${target.hash}` : undefined;
  const query = new URLSearchParams({
    ...(result ? { [result.param]: result.value } : {}),
    ...(passSecondAccount ? { connect_start_result: 'pass_second_account' } : {}),
    ...(returnTo && !returnTo.startsWith('/onboarding') ? { returnTo } : {}),
  });
  return query.size ? `/onboarding?${query}` : '/onboarding';
}
