const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const baseUrl = process.env.SELF_CHECK_API_URL || 'http://127.0.0.1:4280';
let token = '';
let projectId = '';
let runId = '';

async function request(route, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { ...headers, ...options.headers } });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route} failed (${response.status}): ${payload?.message || 'unknown error'}`);
  return payload;
}

async function cleanup() {
  if (token) await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
  if (!projectId) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM audit_logs WHERE entity_id IN (SELECT id::text FROM runs WHERE project_id=$1) OR entity_id=$1::text`, [projectId]);
    await client.query('DELETE FROM runs WHERE project_id=$1', [projectId]);
    await client.query('DELETE FROM projects WHERE id=$1', [projectId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
  if (runId) {
    const root = path.resolve(__dirname, '..', process.env.ARTIFACT_ROOT || 'artifacts/playwright');
    const target = path.resolve(root, runId);
    if (target.startsWith(`${root}${path.sep}`)) await fs.rm(target, { recursive: true, force: true });
  }
}

async function main() {
  const health = await request('/api/health');
  assert.equal(health.status, 'ok');
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identity: process.env.SELF_CHECK_ADMIN || 'admin@automation.local', password: process.env.SELF_CHECK_ADMIN_PASSWORD || 'Admin@12345' }),
  });
  token = login.token;
  assert.equal(login.user.role, 'ADMIN');
  let cdeSession = await request('/api/cde/session');
  const cdePhone = process.env.CDE_SELF_CHECK_PHONE;
  const cdePassword = process.env.CDE_SELF_CHECK_PASSWORD;
  if (!cdeSession.connected && cdePhone && cdePassword) {
    const started = await request('/api/cde/session/start', { method: 'POST', body: JSON.stringify({ userLoginName: cdePhone }) });
    cdeSession = started.connected ? started : await request('/api/cde/session/password', { method: 'POST', body: JSON.stringify({ challenge: started.challenge, password: cdePassword }) });
  }
  if (!cdeSession.connected) {
    const protectedResponse = await fetch(`${baseUrl}/api/cde/projects`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(protectedResponse.status, 401);
    console.log(JSON.stringify({ health: health.status, login: 'ok', cde: 'credentials-not-configured', protectedRoute: 'ok', runner: 'skipped' }, null, 2));
    return;
  }
  const cdeProjects = await request('/api/cde/projects');
  const cdeProject = cdeProjects.find(item => item.projectKey === process.env.CDE_SELF_CHECK_PROJECT) || cdeProjects[0];
  assert.ok(cdeProject, 'The CDE account has no accessible projects.');
  const suffix = Date.now().toString(36);
  const project = await request('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Runner Self Check', code: `runner-self-check-${suffix}`, description: 'Temporary end-to-end verification project.' }) });
  projectId = project.id;
  await request(`/api/projects/${projectId}/cde-mapping`, { method: 'PUT', body: JSON.stringify({ projectKey: cdeProject.projectKey, enabled: true }) });
  const environment = await request(`/api/projects/${projectId}/environments`, { method: 'POST', body: JSON.stringify({ name: 'self-check', baseUrl: 'http://127.0.0.1:5180' }) });
  const file = await request('/api/files', { method: 'POST', body: JSON.stringify({
    projectId, folderPath: 'tests', fileName: 'runner-self-check.spec.js', description: 'Temporary runner check',
    sourceCode: `const { test, expect } = require('@playwright/test');\n\ntest('runner pipeline', async ({ page }) => {\n  await page.setContent('<title>automation self check</title><h1 id="ready">ready</h1>');\n  await expect(page).toHaveTitle('automation self check');\n  await expect(page.locator('#ready')).toHaveText('ready');\n});\n`,
  }) });
  const run = await request('/api/runs', { method: 'POST', body: JSON.stringify({ projectId, environmentId: environment.id, testFileId: file.id, browserProjects: ['chromium'], workers: 1, retries: 0, trace: 'off', reporter: 'json', timeoutSeconds: 60 }) });
  runId = run.id;
  let completed;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    completed = await request(`/api/runs/${runId}`);
    if (['PASSED', 'FAILED', 'ERROR', 'CANCELLED'].includes(completed.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(completed, 'Runner did not return a run.');
  assert.equal(completed.status, 'PASSED', completed.logs || 'Runner did not pass.');
  assert.equal(completed.totalTests, 1);
  assert.equal(completed.passedTests, 1);
  assert.ok(completed.artifacts.some(artifact => artifact.kind === 'LOG'));
  assert.ok(completed.artifacts.some(artifact => artifact.kind === 'REPORT'));
  const report = completed.artifacts.find(artifact => artifact.kind === 'REPORT');
  const download = await fetch(`${baseUrl}/api/artifacts/${report.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(download.status, 200);
  assert.ok((await download.arrayBuffer()).byteLength > 0);
  console.log(JSON.stringify({ health: health.status, login: 'ok', cde: 'connected', cdeProject: cdeProject.projectKey, snapshot: completed.cdeSnapshot?.status, runner: completed.status, totalTests: completed.totalTests, artifacts: completed.artifacts.length }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => cleanup().catch(error => {
  console.error('Self-check cleanup failed:', error);
  process.exitCode = 1;
}));
