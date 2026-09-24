/** Compare only matching monthly, project-scoped USD budgets to fresh export data. */
export function budgetStatus(budgets, spend, now = new Date()) {
  if (!budgets.length) return { status: 'WARN', detail: 'No budgets configured' };
  const matching = budgets.filter((b) => {
    const f = b.budgetFilter ?? {};
    return (
      f.calendarPeriod === 'MONTH' &&
      f.projects?.length === 1 &&
      f.projects[0] === 'projects/387835380133' &&
      !f.services?.length &&
      !f.resourceAncestors?.length &&
      !f.labels &&
      !f.subaccounts?.length &&
      !f.creditTypes?.length &&
      f.creditTypesTreatment === 'INCLUDE_ALL_CREDITS' &&
      b.amount?.specifiedAmount?.currencyCode === 'USD'
    );
  });
  if (!matching.length)
    return {
      status: 'WARN',
      detail: 'Budget configuration exists; no comparable monthly project USD budget',
    };
  if (spend?.status !== 'OK' || !Number.isFinite(spend.costMtdUsd))
    return {
      status: 'WARN',
      detail: 'Budget configured; fresh matching spend unavailable, compliance unknown',
    };
  const start = spend.budgetPeriodStart;
  const end = spend.budgetPeriodEnd;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    now.getTime() < start ||
    now.getTime() >= end
  )
    return {
      status: 'WARN',
      detail: 'Matching Pacific billing period unavailable; budget compliance unknown',
    };
  const elapsed = now.getTime() - start;
  if (elapsed <= 0) return { status: 'WARN', detail: 'Insufficient elapsed month for forecast' };
  const forecast = (Math.max(0, spend.costMtdUsd) * (end - start)) / elapsed;
  const evaluated = matching.map((b) => {
    const a = b.amount.specifiedAmount;
    const limit = Number(a.units ?? 0) + Number(a.nanos ?? 0) / 1e9;
    if (!(limit > 0)) return { status: 'WARN', detail: 'Invalid budget amount' };
    const thresholds = (b.thresholdRules ?? [])
      .filter((r) => r.spendBasis === 'CURRENT_SPEND')
      .map((r) => r.thresholdPercent)
      .filter((n) => Number.isFinite(n) && n > 0);
    const warning = Math.min(1, ...thresholds);
    return {
      status:
        spend.costMtdUsd >= limit
          ? 'BREACH'
          : forecast >= limit || spend.costMtdUsd >= limit * warning
            ? 'WARN'
            : 'OK',
      detail: `${b.displayName}: $${spend.costMtdUsd.toFixed(2)} accrued / $${limit.toFixed(2)} budget; linear estimate $${forecast.toFixed(2)} month-end (not invoice or guarantee)`,
    };
  });
  const rank = { OK: 0, WARN: 1, BREACH: 2 };
  return {
    status: evaluated.reduce((s, e) => (rank[e.status] > rank[s] ? e.status : s), 'OK'),
    detail: evaluated.map((e) => e.detail).join('; '),
  };
}
