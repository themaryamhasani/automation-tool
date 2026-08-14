const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const argon2 = require('argon2');
const JSZip = require('jszip');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
process.env.SKIP_RUN_EVENT_BUS = '1';
const { createServer, pool } = require('../apps/api/src/server.cjs');
const { buildWorkbook } = require('../apps/api/src/reports/excel.cjs');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, method, urlPath, { body, headers, raw } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: urlPath,
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(headers || {}) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let json = null;
        if (!raw) try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buffer });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function insertRun(pool, values) {
  await pool.query(
    `INSERT INTO runs (
        project_id, environment_id, test_file_path, source_snapshot, status, requested_by,
        total_tests, passed_tests, failed_tests, skipped_tests, duration_ms, source_approach, tool_kind,
        started_at, completed_at, requested_at, pack_id, flow_id
      ) VALUES ($1,$2,$3,'fixture',$4,$5,$6,$7,$8,0,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      values.projectId, values.environmentId, values.path, values.status, values.userId,
      values.total ?? 10, values.passed ?? 0, values.failed ?? 0, values.duration ?? 1500,
      values.approach || 'IS', values.tool || 'PLAYWRIGHT',
      values.at, values.at, values.at, values.pack || null, values.flow || null,
    ],
  );
}

test('xlsx workbook contains persian headers and numeric cells', async () => {
  const buffer = await buildWorkbook({
    title: 'خلاصه مدیریتی کیفیت',
    generatedAt: '2026-08-14T10:00:00.000Z',
    filters: { from: '2026-08-01', to: '2026-08-14' },
    kpis: [{ key: 'passRate', label: 'نرخ موفقیت', value: 80, unit: 'percent' }],
    tables: [{
      id: 'byProject',
      title: 'کیفیت به‌ازای پروژه',
      columns: [
        { key: 'projectName', label: 'پروژه', format: 'text' },
        { key: 'passRate', label: 'نرخ موفقیت', format: 'percent' },
      ],
      rows: [{ projectName: 'آلفا', passRate: 80 }],
    }],
  });
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('xl/workbook.xml'));
  assert.ok(zip.file('xl/worksheets/sheet1.xml'));
  const sheet2 = await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.match(sheet2, /پروژه/);
  assert.match(sheet2, /آلفا/);
  assert.match(sheet2, /<v>80<\/v>/);
});

test('reports catalog excel and access filters stay project-scoped', async () => {
  const stamp = Date.now();
  const password = 'QaReport@12345';
  const hash = await argon2.hash(password);
  const admin = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1,$2,$3,'ADMIN') RETURNING id`,
    ['Report Admin', `qa-report-admin-${stamp}@automation.local`, hash],
  );
  const viewer = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1,$2,$3,'VIEWER') RETURNING id`,
    ['Report Viewer', `qa-report-viewer-${stamp}@automation.local`, hash],
  );
  const alpha = await pool.query(
    `INSERT INTO projects (name, code, source_approach) VALUES ($1,$2,'IS') RETURNING id`,
    ['پروژه آلفا گزارش', `rpt-a-${stamp}`],
  );
  const beta = await pool.query(
    `INSERT INTO projects (name, code, source_approach) VALUES ($1,$2,'CDE') RETURNING id`,
    ['پروژه بتا گزارش', `rpt-b-${stamp}`],
  );
  const envA = await pool.query(
    `INSERT INTO environments (project_id, name, base_url) VALUES ($1,'qa-a','http://127.0.0.1') RETURNING id`,
    [alpha.rows[0].id],
  );
  const envB = await pool.query(
    `INSERT INTO environments (project_id, name, base_url) VALUES ($1,'qa-b','http://127.0.0.1') RETURNING id`,
    [beta.rows[0].id],
  );
  await pool.query('INSERT INTO user_projects (user_id, project_id) VALUES ($1,$2)', [viewer.rows[0].id, alpha.rows[0].id]);
  const recent = daysAgo(1);
  const old = daysAgo(40);
  await insertRun(pool, {
    projectId: alpha.rows[0].id, environmentId: envA.rows[0].id, userId: admin.rows[0].id,
    path: 'packs/alpha/login.spec.ts', status: 'PASSED', passed: 10, failed: 0, at: recent.toISOString(), pack: 'alpha', flow: 'login',
  });
  await insertRun(pool, {
    projectId: alpha.rows[0].id, environmentId: envA.rows[0].id, userId: admin.rows[0].id,
    path: 'packs/alpha/login.spec.ts', status: 'FAILED', passed: 7, failed: 3, at: recent.toISOString(), pack: 'alpha', flow: 'login',
  });
  await insertRun(pool, {
    projectId: alpha.rows[0].id, environmentId: envA.rows[0].id, userId: admin.rows[0].id,
    path: 'packs/alpha/secrets', status: 'FAILED', passed: 0, failed: 1, tool: 'GITLEAKS', at: recent.toISOString(),
  });
  await insertRun(pool, {
    projectId: alpha.rows[0].id, environmentId: envA.rows[0].id, userId: admin.rows[0].id,
    path: 'packs/alpha/old.spec.ts', status: 'PASSED', passed: 4, failed: 0, at: old.toISOString(),
  });
  await insertRun(pool, {
    projectId: beta.rows[0].id, environmentId: envB.rows[0].id, userId: admin.rows[0].id,
    path: 'cde/hidden.spec.ts', status: 'PASSED', passed: 8, failed: 0, approach: 'CDE', at: recent.toISOString(),
  });

  const app = createServer();
  const server = await listen(app);
  const from = isoDate(daysAgo(7));
  const to = isoDate(new Date());
  try {
    const denied = await request(server, 'GET', '/api/reports');
    assert.equal(denied.status, 401);

    const loginAdmin = await request(server, 'POST', '/api/auth/login', {
      body: { identity: `qa-report-admin-${stamp}@automation.local`, password },
    });
    assert.equal(loginAdmin.status, 200, loginAdmin.text);
    const adminAuth = { authorization: `Bearer ${loginAdmin.json.token}` };

    const catalog = await request(server, 'GET', '/api/reports', { headers: adminAuth });
    assert.equal(catalog.status, 200, catalog.text);
    assert.ok(catalog.json.reports.some(item => item.id === 'executive'));
    assert.ok(catalog.json.reports.some(item => item.id === 'runs'));
    assert.ok(catalog.json.projects.some(item => item.id === alpha.rows[0].id));

    const missing = await request(server, 'GET', '/api/reports/not-a-report', { headers: adminAuth });
    assert.equal(missing.status, 404);

    const badDate = await request(server, 'GET', `/api/reports/executive?from=14-08-2026`, { headers: adminAuth });
    assert.equal(badDate.status, 422);

    const executive = await request(server, 'GET', `/api/reports/executive?from=${from}&to=${to}`, { headers: adminAuth });
    assert.equal(executive.status, 200, executive.text);
    const names = executive.json.tables.find(table => table.id === 'byProject').rows.map(row => row.projectName);
    assert.ok(names.includes('پروژه آلفا گزارش'));
    assert.ok(names.includes('پروژه بتا گزارش'));
    const alphaRow = executive.json.tables.find(table => table.id === 'byProject').rows.find(row => row.projectName === 'پروژه آلفا گزارش');
    assert.equal(alphaRow.totalRuns, 3);
    assert.ok(executive.json.tables.find(table => table.id === 'flakyTargets') == null);
    const failures = executive.json.tables.find(table => table.id === 'topFailures').rows;
    assert.ok(failures.some(row => row.testFilePath === 'packs/alpha/login.spec.ts'));

    const quality = await request(server, 'GET', `/api/reports/quality?from=${from}&to=${to}&projectId=${alpha.rows[0].id}`, { headers: adminAuth });
    assert.equal(quality.status, 200, quality.text);
    const flaky = quality.json.tables.find(table => table.id === 'flakyTargets').rows;
    assert.ok(flaky.some(row => row.testFilePath === 'packs/alpha/login.spec.ts'));

    const security = await request(server, 'GET', `/api/reports/security?from=${from}&to=${to}&projectId=${alpha.rows[0].id}`, { headers: adminAuth });
    assert.equal(security.status, 200, security.text);
    const securityTools = security.json.tables.find(table => table.id === 'byTool').rows.map(row => row.toolKind);
    assert.deepEqual(securityTools, ['GITLEAKS']);

    const engineering = await request(server, 'GET', `/api/reports/engineering?from=${from}&to=${to}&projectId=${alpha.rows[0].id}`, { headers: adminAuth });
    assert.equal(engineering.status, 200, engineering.text);
    assert.ok(engineering.json.tables.find(table => table.id === 'byTool').rows.some(row => row.toolKind === 'PLAYWRIGHT'));
    const team = await request(server, 'GET', `/api/reports/team?from=${from}&to=${to}&projectId=${alpha.rows[0].id}`, { headers: adminAuth });
    assert.equal(team.status, 200, team.text);
    assert.ok(team.json.tables.find(table => table.id === 'byRequester').rows.some(row => row.fullName === 'Report Admin'));

    const runs = await request(server, 'GET', `/api/reports/runs?from=${from}&to=${to}&projectId=${alpha.rows[0].id}&search=login`, { headers: adminAuth });
    assert.equal(runs.status, 200, runs.text);
    assert.equal(runs.json.pagination.total, 2);
    assert.ok(runs.json.tables[0].rows.every(row => String(row.testFilePath).includes('login')));

    const excel = await request(server, 'GET', `/api/reports/executive/excel?from=${from}&to=${to}&projectId=${alpha.rows[0].id}`, { headers: adminAuth, raw: true });
    assert.equal(excel.status, 200, excel.text.slice(0, 200));
    assert.match(String(excel.headers['content-type']), /spreadsheetml/);
    const zip = await JSZip.loadAsync(excel.buffer);
    const sheet = await zip.file('xl/worksheets/sheet2.xml').async('string');
    assert.match(sheet, /پروژه آلفا گزارش/);
    assert.doesNotMatch(sheet, /پروژه بتا گزارش/);

    const loginViewer = await request(server, 'POST', '/api/auth/login', {
      body: { identity: `qa-report-viewer-${stamp}@automation.local`, password },
    });
    const viewerAuth = { authorization: `Bearer ${loginViewer.json.token}` };
    const scoped = await request(server, 'GET', `/api/reports/executive?from=${from}&to=${to}`, { headers: viewerAuth });
    assert.equal(scoped.status, 200, scoped.text);
    const scopedNames = scoped.json.tables.find(table => table.id === 'byProject').rows.map(row => row.projectName);
    assert.ok(scopedNames.includes('پروژه آلفا گزارش'));
    assert.equal(scopedNames.includes('پروژه بتا گزارش'), false);

    const forbidden = await request(server, 'GET', `/api/reports/executive?projectId=${beta.rows[0].id}`, { headers: viewerAuth });
    assert.equal(forbidden.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    const projectIds = [alpha.rows[0].id, beta.rows[0].id];
    const userIds = [admin.rows[0].id, viewer.rows[0].id];
    await pool.query('DELETE FROM runs WHERE project_id = ANY($1::uuid[])', [projectIds]);
    await pool.query('DELETE FROM environments WHERE project_id = ANY($1::uuid[])', [projectIds]);
    await pool.query('DELETE FROM user_projects WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query("DELETE FROM audit_logs WHERE action='REPORT_EXPORTED' AND actor_id = ANY($1::uuid[])", [userIds]);
    await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [projectIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
});
