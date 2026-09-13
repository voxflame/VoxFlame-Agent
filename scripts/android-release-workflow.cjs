'use strict';

const WORKFLOW = 'android-preview-release.yml';
const EVENTS = new Set(['push', 'schedule', 'workflow_dispatch']);

/** Accept only this repository's immutable main build, never a fork or PR artifact. */
function trustedRun(run, repo, workflowId, sha) {
  return run.workflow_id === workflowId && run.head_branch === 'main'
    && run.head_sha === sha && run.head_repository?.full_name === `${repo.owner}/${repo.repo}`
    && EVENTS.has(run.event);
}

async function hasSuccessfulBuild(github, repo, runId) {
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...repo, run_id: runId, per_page: 100,
  });
  return jobs.some(job => job.name === 'build-candidate' && job.conclusion === 'success');
}

async function hasArtifact(github, repo, runId) {
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    ...repo, run_id: runId, per_page: 100,
  });
  return artifacts.some(a => !a.expired && a.name === `android-preview-${runId}`);
}

/** Reuse a verified build even when its later publication failed; never rebuild just to retry delivery. */
async function selectSource({ github, context, core }) {
  if (context.ref !== 'refs/heads/main' || !EVENTS.has(context.eventName)) {
    throw new Error('Website releases must run on main');
  }
  const repo = context.repo;
  const sha = context.sha;
  core.setOutput('sha', sha);
  const workflow = (await github.rest.actions.getWorkflow({ ...repo, workflow_id: WORKFLOW })).data;
  if (![true, 'true'].includes(context.payload.inputs?.force_rebuild)) {
    const runs = (await github.rest.actions.listWorkflowRuns({
      ...repo, workflow_id: WORKFLOW, branch: 'main', status: 'completed', head_sha: sha, per_page: 100,
    })).data.workflow_runs;
    for (const run of runs) {
      if (!trustedRun(run, repo, workflow.id, sha) || run.id === context.runId) continue;
      if (await hasSuccessfulBuild(github, repo, run.id) && await hasArtifact(github, repo, run.id)) {
        core.setOutput('build', 'false');
        core.setOutput('artifact_run_id', String(run.id));
        await core.summary.addRaw(`Reuse build ${run.id} for main ${sha}; continue to publication.`).write();
        return;
      }
    }
  }
  core.setOutput('build', 'true');
  core.setOutput('artifact_run_id', String(context.runId));
  await core.summary.addRaw(`Build main ${sha}, then automatically publish the same APK.`).write();
}

/** Re-check trust, build result and current main immediately before delivery. */
async function validatePublication({ github, context, core }, runId, sha) {
  if (context.ref !== 'refs/heads/main' || !EVENTS.has(context.eventName)
    || !/^[1-9][0-9]{0,15}$/.test(String(runId)) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Invalid release context');
  }
  const repo = context.repo;
  const latest = (await github.rest.repos.getCommit({ ...repo, ref: 'main' })).data.sha;
  if (latest !== sha) throw new Error('Source is no longer latest main; refusing stale publication');
  const run = (await github.rest.actions.getWorkflowRun({ ...repo, run_id: Number(runId) })).data;
  const workflow = (await github.rest.actions.getWorkflow({ ...repo, workflow_id: WORKFLOW })).data;
  if (!trustedRun(run, repo, workflow.id, sha)
    || !await hasSuccessfulBuild(github, repo, run.id) || !await hasArtifact(github, repo, run.id)) {
    throw new Error('Only trusted successful main builds with retained artifacts can be published');
  }
  core.exportVariable('CANDIDATE_SOURCE_SHA', sha);
  core.exportVariable('CANDIDATE_RUN_ID', String(run.id));
}

module.exports = { selectSource, validatePublication, trustedRun };
