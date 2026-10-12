import { pathToFileURL } from 'node:url';

const repository = 'CT2689-Tech/DeclutrMail';
const project = 'prj_hWYbyer4xJEWfCiSb9M3krrdh5D7';
const repoId = '1238347982';
const activeStates = ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY'];
const deploymentUrl = 'https://vercel.com/chintanathakkar-gmailcoms-projects/declutr-mail/';

export async function ensureQueuePreview(env = process.env, fetcher = fetch) {
  const branch = env.QUEUE_BRANCH;
  const sha = env.QUEUE_SHA;
  if (
    env.GITHUB_REPOSITORY !== repository ||
    !/^gh-readonly-queue\/main\/pr-\d+-[a-f0-9]{40}$/.test(branch ?? '') ||
    !/^[a-f0-9]{40}$/.test(sha ?? '')
  )
    throw new Error('Expected this repository and an exact main merge-queue ref/SHA');
  if (!env.GH_TOKEN || !env.VERCEL_TOKEN || !/^team_[A-Za-z0-9]+$/.test(env.VERCEL_TEAM_ID ?? ''))
    throw new Error('Queue preview credentials/team are unavailable');

  const gh = `https://api.github.com/repos/${repository}/git/ref/heads/${branch}`;
  const team = encodeURIComponent(env.VERCEL_TEAM_ID);
  const request = async (url, token, body) => {
    const response = await fetcher(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    // A deleted queue ref means this candidate has merged or was removed.
    if (url === gh && response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Queue preview ${body ? 'creation' : 'lookup'} failed (${response.status})`);
    return response.json();
  };
  const current = async () => {
    const ref = await request(gh, env.GH_TOKEN);
    if (ref === null) return false;
    if (!/^[a-f0-9]{40}$/.test(ref?.object?.sha ?? ''))
      throw new Error('Queue ref identity is unavailable');
    return ref.object.sha === sha;
  };
  const deploymentIdFromUrl = (url) => {
    if (typeof url !== 'string' || !url.startsWith(deploymentUrl)) return '';
    const suffix = url.slice(deploymentUrl.length).split(/[?#]/)[0];
    return /^[A-Za-z0-9]+$/.test(suffix) ? `dpl_${suffix}` : '';
  };
  const latestVercelStatus = async () => {
    const statuses = await request(
      `https://api.github.com/repos/${repository}/commits/${sha}/statuses?per_page=100`,
      env.GH_TOKEN,
    );
    if (!Array.isArray(statuses)) throw new Error('Queue commit statuses are unavailable');
    return statuses.find((s) => s.context === 'Vercel') ?? null;
  };
  if (!(await current())) return { state: 'stale' };

  const list = await request(
    `https://api.vercel.com/v6/deployments?teamId=${team}&projectId=${project}&sha=${sha}&limit=20`,
    env.VERCEL_TOKEN,
  );
  if (!Array.isArray(list.deployments)) throw new Error('Vercel deployment list is unavailable');
  const existing = list.deployments.find(
    (d) =>
      d.meta?.githubCommitSha === sha && d.meta?.githubCommitRef === branch && d.target === null,
  );
  if (existing) {
    const state = existing.state ?? existing.readyState;
    const id = existing.uid ?? existing.id;
    // Ignored Build Step cancels the deployment. Vercel posts
    // "Canceled by Ignored Build Step" on the base SHA, not this queue
    // SHA (runs 38283948924 and 38290639082), so the queue commit often
    // has no Vercel status. A cancel with no failure status is that
    // ignore. A Vercel failure/error status, or any other terminal
    // state, is a real build failure.
    if (state === 'CANCELED') {
      const latest = await latestVercelStatus();
      if (latest?.state !== 'failure' && latest?.state !== 'error') return { state: 'ignored', id };
    }
    if (!activeStates.includes(state))
      throw new Error(
        'Existing queue preview failed or was cancelled; diagnose it before retrying',
      );
    return { state: 'existing', id };
  }
  // The queue may have advanced while we queried Vercel. Never deploy a
  // replacement ref or turn an obsolete candidate into additional work.
  if (!(await current())) return { state: 'stale' };
  // Queue previews are skipped by the ignore script. A second deployment
  // would post pending and the merge queue would wait on that build.
  // Create one only when Vercel has posted no status for this commit, so a
  // missing native check can still be produced (and then ignored).
  const latest = await latestVercelStatus();
  if (latest?.creator?.login === 'vercel[bot]') {
    const id = deploymentIdFromUrl(latest.target_url);
    if (id && latest.state === 'success' && latest.description === 'Canceled by Ignored Build Step')
      return { state: 'ignored', id };
    if (id && latest.state === 'success') return { state: 'existing', id };
    if (latest.state === 'pending' && (id || !latest.target_url))
      return id ? { state: 'existing', id } : { state: 'existing' };
    if (id && (latest.state === 'failure' || latest.state === 'error'))
      throw new Error(
        'Existing queue preview failed or was cancelled; diagnose it before retrying',
      );
  }
  const deployment = await request(
    `https://api.vercel.com/v13/deployments?teamId=${team}`,
    env.VERCEL_TOKEN,
    {
      name: 'declutr-mail',
      project,
      gitSource: { type: 'github', repoId, ref: branch, sha },
      meta: {
        githubCommitRef: branch,
        githubCommitSha: sha,
        githubOrg: 'CT2689-Tech',
        githubRepo: 'DeclutrMail',
      },
      // Omitting target requests a preview. Never set production or override
      // project settings/environment; the provider posts its own Vercel check.
    },
  );
  if (
    deployment.target !== null ||
    deployment.meta?.githubCommitSha !== sha ||
    deployment.meta?.githubCommitRef !== branch ||
    !activeStates.includes(deployment.readyState ?? deployment.state) ||
    !deployment.id
  )
    throw new Error('Created deployment does not match the exact preview candidate');
  return { state: 'created', id: deployment.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await ensureQueuePreview();
  console.log(`Queue preview: ${result.state}${result.id ? ` (${result.id})` : ''}.`);
}
