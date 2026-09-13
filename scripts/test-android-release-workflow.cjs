'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectSource, validatePublication } = require('./android-release-workflow.cjs');
const SHA = 'a'.repeat(40);
function fixture(overrides = {}) {
  const output = {};
  const run = {id: 42, workflow_id: 7, head_branch: 'main', head_sha: SHA,
    head_repository: {full_name: 'owner/repo'}, event: 'push', ...overrides};
  const state = {runs: [run], jobs: [{name: 'build-candidate', conclusion: 'success'}],
    artifacts: [{name: 'android-preview-42', expired: false}], latest: SHA};
  const listJobs = () => {};
  const listArtifacts = () => {};
  const github = {rest: {
    actions: {getWorkflow: async () => ({data: {id: 7}}),
      listWorkflowRuns: async () => ({data: {workflow_runs: state.runs}}),
      getWorkflowRun: async () => ({data: run}),
      listJobsForWorkflowRun: listJobs, listWorkflowRunArtifacts: listArtifacts},
    repos: {getCommit: async () => ({data: {sha: state.latest}})}},
    paginate: async fn => fn === listJobs ? state.jobs : state.artifacts};
  const core = {setOutput: (key, value) => {output[key] = value;},
    exportVariable: (key, value) => {output[key] = value;},
    summary: {addRaw: () => ({write: async () => {}})}};
  const context = {repo: {owner: 'owner', repo: 'repo'}, sha: SHA,
    ref: 'refs/heads/main', eventName: 'push', runId: 43, payload: {}};
  return {github, core, context, output, state};
}
test('reuse successful build even after failed publication', async () => {
  const f = fixture({conclusion: 'failure'});
  await selectSource(f);
  assert.equal(f.output.build, 'false');
  assert.equal(f.output.artifact_run_id, '42');
});
test('new SHA builds and publishes its own artifact', async () => {
  const f = fixture(); f.state.runs = [];
  await selectSource(f); assert.equal(f.output.build, 'true'); assert.equal(f.output.artifact_run_id, '43');
});
for (const value of [true, 'true']) test(`force rebuild ${typeof value}`, async () => {
  const f = fixture(); f.context.payload.inputs = {force_rebuild: value};
  await selectSource(f); assert.equal(f.output.build, 'true');
});
for (const change of [
  {head_branch: 'other'}, {head_sha: 'b'.repeat(40)}, {workflow_id: 8},
  {head_repository: {full_name: 'fork/repo'}}, {event: 'pull_request'},
]) test(`reject untrusted run ${JSON.stringify(change)}`, async () => {
  const f = fixture(change); await selectSource(f); assert.equal(f.output.build, 'true');
  await assert.rejects(validatePublication(f, '42', SHA));
});
for (const conclusion of ['failure', 'cancelled', 'skipped', null]) test(`build ${conclusion} cannot publish`, async () => {
  const f = fixture(); f.state.jobs[0].conclusion = conclusion;
  await selectSource(f); assert.equal(f.output.build, 'true');
  await assert.rejects(validatePublication(f, '42', SHA));
});
for (const artifacts of [[], [{name: 'other', expired: false}], [{name: 'android-preview-42', expired: true}]]) {
  test(`missing or expired artifact ${JSON.stringify(artifacts)}`, async () => {
    const f = fixture(); f.state.artifacts = artifacts;
    await selectSource(f); assert.equal(f.output.build, 'true');
    await assert.rejects(validatePublication(f, '42', SHA));
  });
}
test('current run may be in progress after successful build', async () => {
  const f = fixture({status: 'in_progress', conclusion: null});
  await validatePublication(f, '42', SHA); assert.equal(f.output.CANDIDATE_RUN_ID, '42');
});
test('main advancing prevents stale publication', async () => {
  const f = fixture(); f.state.latest = 'b'.repeat(40);
  await assert.rejects(validatePublication(f, '42', SHA), /latest main/);
});
test('branch and PR dispatch cannot release', async () => {
  const f = fixture(); f.context.ref = 'refs/heads/feature';
  await assert.rejects(selectSource(f)); await assert.rejects(validatePublication(f, '42', SHA));
});
