import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function auditQueue(required, policy, workflows) {
  const errors = [];
  const external = [];
  for (const [name, file] of Object.entries(policy)) {
    if (!required.some((check) => check.context === name && check.app_id === 15368)) {
      errors.push(`Missing required GitHub Actions check: ${name}`);
    }
    if (!workflows[file]?.includes(`    name: ${name}\n`))
      errors.push(`${file}: missing producer for ${name}`);
  }
  for (const { context } of required) {
    const producers = Object.entries(workflows).filter(([, source]) =>
      source.includes(`    name: ${context}\n`),
    );
    if (!producers.length) {
      external.push(context);
      continue;
    }
    if (producers.length > 1) errors.push(`${context}: multiple workflow producers`);
    for (const [file, source] of producers) {
      const triggers = source.match(/^on:\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m)?.[1] || '';
      if (!/^ {2}merge_group:/m.test(triggers))
        errors.push(`${file}: ${context} never reports for merge_group`);
      // Workflow-level PR filters can leave required contexts pending forever.
      const prTrigger =
        triggers.match(/^ {2}pull_request:\n([\s\S]*?)(?=^ {2}\S|$(?![\s\S]))/m)?.[1] || '';
      if (/^ {4}(paths|paths-ignore|branches|branches-ignore):/m.test(prTrigger))
        errors.push(`${file}: required workflow has event-level filters`);
    }
  }
  return { errors, external };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.argv[2] || 'CT2689-Tech/DeclutrMail';
  const protection = JSON.parse(
    execFileSync('gh', ['api', `repos/${repo}/branches/main/protection`], { encoding: 'utf8' }),
  );
  const rules = JSON.parse(
    execFileSync('gh', ['api', `repos/${repo}/rules/branches/main`], { encoding: 'utf8' }),
  );
  const required = [...(protection.required_status_checks?.checks || [])];
  for (const rule of rules) {
    if (rule.type === 'required_status_checks') {
      for (const check of rule.parameters.required_status_checks)
        required.push({ context: check.context, app_id: check.integration_id });
    }
  }
  const folder = new URL('../.github/workflows/', import.meta.url);
  const workflows = Object.fromEntries(
    readdirSync(folder)
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => [file, readFileSync(new URL(file, folder), 'utf8')]),
  );
  const policy = JSON.parse(
    readFileSync(new URL('./required-checks.json', import.meta.url), 'utf8'),
  );
  const { errors, external } = auditQueue(required, policy, workflows);
  for (const error of errors) console.error(error);
  for (const name of external)
    console.log(
      `EXTERNAL: ${name} — verify an actual merge-group check/status; static audit cannot prove it.`,
    );
  if (errors.length) process.exitCode = 1;
  else
    console.log(
      'Required-check policy and repository merge-group producers match. External checks still require runtime evidence.',
    );
}
