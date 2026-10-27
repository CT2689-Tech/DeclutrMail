/** Vercel CLI 64.7 contracts: budget amounts are USD; /teams/:id/spend is cents. */
export function readVercelBudget(response, teamId) {
  if (!/^team_[A-Za-z0-9]+$/.test(teamId) || !Array.isArray(response?.data))
    throw new Error('Invalid Vercel team budget response');
  const active = response.data.filter(
    (b) => b?.ownerId === teamId && b.scope === 'team' && b.status === 'active',
  );
  if (active.length > 1) throw new Error('Ambiguous active Vercel team budgets');
  if (!active.length)
    return {
      amountUsd: null,
      pausePercent: null,
      warnPercent: null,
      causes: [{ status: 'BREACH', text: 'No active Vercel team on-demand budget' }],
    };
  const budget = active[0];
  if (
    !['string', 'number'].includes(typeof budget.amount) ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(budget.amount))
  )
    throw new Error('Invalid Vercel budget amount');
  const amountUsd = Number(budget.amount);
  if (!(amountUsd > 0) || !Number.isSafeInteger(Math.round(amountUsd * 100)))
    throw new Error('Invalid Vercel budget amount');
  if (!Array.isArray(budget.thresholds) || !budget.thresholds.length)
    throw new Error('Missing Vercel budget thresholds');
  for (const t of budget.thresholds)
    if (
      !(
        typeof t?.percent === 'number' &&
        Number.isFinite(t.percent) &&
        t.percent > 0 &&
        t.percent <= 100
      ) ||
      typeof t.sendNotifications !== 'boolean' ||
      typeof t.pauseUsage !== 'boolean'
    )
      throw new Error('Invalid Vercel budget threshold');
  const pauseAt = budget.thresholds.filter((t) => t.pauseUsage).map((t) => t.percent);
  const pausePercent = pauseAt.length ? Math.min(...pauseAt) : null;
  const notifications = budget.thresholds
    .filter((t) => t.sendNotifications && t.percent < (pausePercent ?? 100))
    .map((t) => t.percent);
  const warnPercent = notifications.length ? Math.min(...notifications) : null;
  const causes = [];
  if (pausePercent === null)
    causes.push({ status: 'BREACH', text: 'Vercel production auto-pause is not enabled' });
  if (warnPercent === null)
    causes.push({ status: 'BREACH', text: 'Vercel has no notification before its stop threshold' });
  return { amountUsd, pausePercent, warnPercent, causes };
}

export function assessVercelSpend(budget, response) {
  const cents = response?.data?.currentSpend;
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0)
    throw new Error('Missing or invalid Vercel current-cycle spend');
  const spentUsd = cents / 100;
  const causes = [...budget.causes];
  const usage = { vercel_cycle_spend_usd: spentUsd };
  let usagePct;
  if (budget.amountUsd !== null) {
    usage.vercel_on_demand_budget_usd = budget.amountUsd;
    usage.vercel_pause_enabled = budget.pausePercent === null ? 0 : 1;
    usagePct = Math.round((spentUsd / budget.amountUsd) * 100);
    const stopAt = budget.amountUsd * ((budget.pausePercent ?? 100) / 100);
    const warnAt = budget.amountUsd * ((budget.warnPercent ?? 100) / 100);
    causes.push({
      status: spentUsd >= stopAt ? 'BREACH' : spentUsd >= warnAt ? 'WARN' : 'OK',
      text: `Current-cycle on-demand spend $${spentUsd.toFixed(2)} / $${budget.amountUsd.toFixed(2)} budget; production pause ${budget.pausePercent === null ? 'disabled' : `at ${budget.pausePercent}%`}`,
      value: spentUsd,
    });
  }
  return { usage, usagePct, causes };
}
