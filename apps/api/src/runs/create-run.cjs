const path = require('node:path');
const { isTool } = require('../approaches/constants.cjs');
const isService = require('../approaches/is/service.cjs');
const localPack = require('../approaches/local-pack.cjs');
const { getBinding, loadConnection } = require('../approaches/routes.cjs');
const { loadCdeProjectContext } = require('../cde/project-context.cjs');
const { parsePositiveInt } = require('../http.cjs');
const { notifyRun } = require('../../../../shared/log-excerpt.cjs');

const TRACE_MODES = new Set(['off', 'on', 'retain-on-failure', 'on-first-retry']);
const REPORTERS = new Set(['html', 'json', 'junit']);
const BROWSERS = new Set(['chromium', 'firefox', 'webkit']);

class RunCreateError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function ensureWorkspaceProject(pool, user, approach) {
  const code = `ws-${String(approach || 'is').toLowerCase().replace(/_/g, '-')}`;
  const names = { CDE: 'فضای کار CDE', IS: 'فضای کار IS', GITHUB: 'فضای کار GitHub', GIT_EDUS: 'فضای کار git.edus.ir', ZIP: 'فضای کار ZIP' };
  let result = await pool.query('SELECT * FROM projects WHERE code=$1', [code]);
  if (!result.rowCount) {
    try {
      result = await pool.query(
        `INSERT INTO projects (name, code, description, source_approach) VALUES ($1,$2,$3,$4) RETURNING *`,
        [names[approach] || `Workspace ${approach}`, code, 'پروژه سیستمی پنل اتوماسیون', approach],
      );
    } catch (error) {
      if (error.code !== '23505') throw error;
      result = await pool.query('SELECT * FROM projects WHERE code=$1', [code]);
    }
  } else if (result.rows[0].source_approach !== approach) {
    result = await pool.query('UPDATE projects SET source_approach=$1, updated_at=now() WHERE id=$2 RETURNING *', [approach, result.rows[0].id]);
  }
  await pool.query('INSERT INTO user_projects (user_id, project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, result.rows[0].id]);
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    sourceApproach: row.source_approach,
    source_approach: row.source_approach,
  };
}

async function ensureEnvironment(pool, projectId, name, baseUrl) {
  const existing = await pool.query('SELECT * FROM environments WHERE project_id=$1 AND name=$2', [projectId, name]);
  if (existing.rowCount) return existing.rows[0];
  const result = await pool.query(
    `INSERT INTO environments (project_id,name,base_url,enabled) VALUES ($1,$2,$3,true) RETURNING *`,
    [projectId, name, baseUrl],
  );
  return result.rows[0];
}

async function resolveEnvironment(pool, project, body) {
  if (body?.environmentId) {
    const environment = await pool.query(
      `SELECT * FROM environments WHERE id=$1 AND project_id=$2 AND enabled=true
        AND (available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now())`,
      [body.environmentId, project.id],
    );
    if (!environment.rowCount) throw new RunCreateError('ENVIRONMENT_REQUIRED', 'محیط فعال انتخاب کنید.', 422);
    return environment.rows[0];
  }
  if (project.source_approach === 'IS') {
    const pack = isService.getPack(body?.packId);
    const baseUrl = pack?.health?.[0]?.url?.replace(/\/health$/, '') || 'http://127.0.0.1:4000';
    return ensureEnvironment(pool, project.id, pack ? `is-${pack.id.toLowerCase()}` : 'is-runtime', baseUrl);
  }
  if (project.source_approach === 'ZIP') {
    return ensureEnvironment(pool, project.id, 'zip-local', 'http://127.0.0.1');
  }
  if (project.source_approach === 'GITHUB' || project.source_approach === 'GIT_EDUS') {
    return ensureEnvironment(pool, project.id, 'remote-source', 'http://127.0.0.1');
  }
  if (project.source_approach === 'CDE') {
    return ensureEnvironment(pool, project.id, 'cde-runtime', 'http://127.0.0.1:4520');
  }
  throw new RunCreateError('ENVIRONMENT_REQUIRED', 'محیط فعال انتخاب کنید.', 422);
}

function toolKindOf(project, body) {
  const requested = String(body?.toolKind || '').toUpperCase();
  if (requested && !isTool(requested)) throw new RunCreateError('INVALID_TOOL', 'ابزار تست معتبر نیست.', 422);
  if (project.source_approach === 'CDE') return requested || 'PLAYWRIGHT';
  return requested || 'DANGER';
}

function normalizeBrowsers(value) {
  if (!Array.isArray(value) || !value.length) return ['chromium'];
  const projects = [...new Set(value.filter(item => BROWSERS.has(item)))];
  if (!projects.length) throw new RunCreateError('BROWSER_REQUIRED', 'حداقل یک مرورگر انتخاب کنید.', 422);
  return projects;
}

async function createClassicCdeFileRun(pool, user, project, body) {
  const projectId = project.id;
  const settings = await pool.query(
    'SELECT enabled, default_timeout_seconds, default_workers, default_retries, default_trace, default_reporter FROM runner_settings WHERE id=1',
  );
  if (!settings.rows[0]?.enabled) throw new RunCreateError('RUNNER_DISABLED', 'Runner در تنظیمات غیرفعال است.', 409);
  const cdeContext = await loadCdeProjectContext(pool, user, projectId, { requireConnection: false, required: false });
  const file = await pool.query(
    'SELECT id, folder_path, file_name, revision, source_code, cde_binding FROM test_files WHERE id=$1 AND project_id=$2',
    [body.testFileId, projectId],
  );
  if (!file.rowCount) throw new RunCreateError('FILE_REQUIRED', 'فایل تست معتبر انتخاب کنید.', 422);
  let environmentRow;
  if (body?.environmentId) {
    const environment = await pool.query(
      `SELECT id, name, base_url, api_base_url, gateway_base_url, available_from, available_until
         FROM environments WHERE id=$1 AND project_id=$2 AND enabled=true
           AND (available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now())`,
      [body.environmentId, projectId],
    );
    if (!environment.rowCount) throw new RunCreateError('ENVIRONMENT_REQUIRED', 'محیط فعال انتخاب کنید.', 422);
    environmentRow = environment.rows[0];
  } else {
    environmentRow = await ensureEnvironment(pool, projectId, 'playwright-local', 'http://127.0.0.1');
  }
  const browsers = normalizeBrowsers(body?.browserProjects);
  const trace = TRACE_MODES.has(body?.trace) ? body.trace : settings.rows[0].default_trace;
  const reporter = REPORTERS.has(body?.reporter) ? body.reporter : settings.rows[0].default_reporter;
  const workers = parsePositiveInt(body?.workers, settings.rows[0].default_workers, 1, 32);
  const retries = parsePositiveInt(body?.retries, settings.rows[0].default_retries, 0, 10);
  const timeoutSeconds = parsePositiveInt(body?.timeoutSeconds, settings.rows[0].default_timeout_seconds, 5, 3600);
  const maxFailures = body?.maxFailures === null || body?.maxFailures === 'unlimited'
    ? null : parsePositiveInt(body?.maxFailures, null, 1, 1000);
  const cdeManifest = {
    ...cdeContext,
    testFile: {
      id: file.rows[0].id,
      path: `${file.rows[0].folder_path}/${file.rows[0].file_name}`,
      revision: file.rows[0].revision,
      binding: file.rows[0].cde_binding || null,
    },
    environment: {
      id: environmentRow.id, name: environmentRow.name, baseUrl: environmentRow.base_url,
      apiBaseUrl: environmentRow.api_base_url, gatewayBaseUrl: environmentRow.gateway_base_url,
      availability: { from: environmentRow.available_from, until: environmentRow.available_until },
    },
    playwright: { browsers, headed: Boolean(body?.headed), workers, retries, maxFailures, trace, reporter, timeoutSeconds },
  };
  const useSnapshot = Boolean(cdeContext.projectKey && cdeContext.connected);
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    let snapshotId = null;
    if (useSnapshot) {
      const snapshot = await client.query(
        `INSERT INTO cde_source_snapshots (project_id,requested_by,initiating_session_id,status,manifest)
         VALUES ($1,$2,$3,'PENDING',$4::jsonb) RETURNING id`,
        [projectId, user.id, user.sessionId, JSON.stringify({ requestedAt: new Date().toISOString(), cdeContext })],
      );
      snapshotId = snapshot.rows[0].id;
    }
    result = await client.query(
      `INSERT INTO runs (project_id,environment_id,test_file_id,test_file_path,source_snapshot,browser_projects,headed,workers,retries,max_failures,trace,reporter,timeout_seconds,requested_by,status,cde_project_key,cde_manifest,cde_snapshot_id,source_approach,tool_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,'CDE','PLAYWRIGHT')
       RETURNING id, project_id, status, source_approach, tool_kind, pack_id, flow_id, test_file_path, cde_snapshot_id`,
      [projectId, environmentRow.id, file.rows[0].id, `${file.rows[0].folder_path}/${file.rows[0].file_name}`, file.rows[0].source_code,
        browsers, Boolean(body?.headed), workers, retries, maxFailures, trace, reporter, timeoutSeconds, user.id,
        useSnapshot ? 'PREPARING' : 'QUEUED', cdeContext.projectKey, JSON.stringify(cdeManifest), snapshotId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await notifyRun(pool, result.rows[0].id);
  return result.rows[0];
}

async function createApproachRun(pool, user, project, body) {
  const approach = project.sourceApproach || project.source_approach;
  if (approach === 'CDE' && body?.testFileId) return createClassicCdeFileRun(pool, user, project, body);
  const projectId = project.id;
  const settings = await pool.query('SELECT * FROM runner_settings WHERE id=1');
  if (!settings.rows[0]?.enabled) throw new RunCreateError('RUNNER_DISABLED', 'Runner در تنظیمات غیرفعال است.', 409);
  const toolKind = toolKindOf({ ...project, source_approach: approach }, body);
  const environment = await resolveEnvironment(pool, { ...project, source_approach: approach, id: projectId }, body);
  const binding = await getBinding(pool, projectId);
  const browsers = Array.isArray(body?.browserProjects) && body.browserProjects.length ? body.browserProjects : ['chromium'];
  let testFilePath = '';
  let sourceSnapshot = '';
  let packId = body?.packId ? String(body.packId) : (binding?.config?.packId || null);
  if (approach === 'IS' && packId) packId = packId.toUpperCase();
  let flowId = body?.flowId ? String(body.flowId).toUpperCase() : null;
  let toolTarget = body?.toolTarget ? String(body.toolTarget) : null;
  const reportPaths = {};

  if (approach === 'IS') {
    if (!packId) throw new RunCreateError('PACK_REQUIRED', 'بسته IS را انتخاب کنید.', 422);
    const health = await isService.packHealth(packId);
    if (!health.ready) throw new RunCreateError('IS_RUNTIME_DOWN', health.message, 409, health);
    const catalog = isService.packCatalog(packId);
    if (toolKind === 'DANGER') {
      const allowed = ['ALL', ...(catalog.automatedFlows || catalog.flows)];
      flowId = flowId || 'ALL';
      if (!allowed.includes(flowId) && flowId !== 'GRD') throw new RunCreateError('INVALID_FLOW', 'فلو انتخاب‌شده برای Node danger معتبر نیست.', 422);
      testFilePath = `${catalog.docPath}/${catalog.tools.DANGER.cwd}/${catalog.tools.DANGER.entry}`;
      toolTarget = flowId;
    } else if (toolKind === 'K6') {
      testFilePath = `${catalog.docPath}/${catalog.tools.K6.cwd}/${catalog.tools.K6.script}`;
      toolTarget = catalog.tools.K6.script;
    } else if (toolKind === 'PLAYWRIGHT') {
      const selected = String(body?.testFilePath || '').replace(/\\/g, '/').replace(/^doc\//, '');
      if (selected && !/\.(spec|test)\.(ts|js)$/i.test(selected)) {
        throw new RunCreateError(
          'PLAYWRIGHT_SPEC_REQUIRED',
          'برای Playwright فایل .spec.ts یا .test.ts از پوشه e2e انتخاب کنید. اسکریپت‌های .mjs را با Node danger اجرا کنید.',
          422,
        );
      }
      if (/\.(spec|test)\.(ts|js)$/i.test(selected)) {
        testFilePath = selected;
        toolTarget = selected;
      } else {
        testFilePath = `${catalog.docPath}/${catalog.tools.PLAYWRIGHT.cwd}`;
        toolTarget = catalog.tools.PLAYWRIGHT.npmScript;
      }
    } else {
      testFilePath = catalog.tools.VITEST.cwd;
      toolTarget = catalog.tools.VITEST.command.join(' ');
    }
    sourceSnapshot = JSON.stringify({ approach: 'IS', packId: catalog.id, toolKind, flowId, catalog: catalog.tools });
    reportPaths.product = `test/doc/${catalog.docPath}/reports`;
  } else if (approach === 'CDE') {
    const projectKey = String(body?.packId || body?.projectKey || packId || '').trim();
    if (!projectKey) throw new RunCreateError('CDE_PROJECT_REQUIRED', 'پروژه CDE را انتخاب کنید.', 422);
    packId = projectKey;
    const session = await pool.query('SELECT session_id FROM cde_sessions WHERE session_id=$1 AND expires_at > now()', [user.sessionId]);
    if (!session.rowCount) throw new RunCreateError('CDE_CONNECTION_REQUIRED', 'ابتدا حساب CDE را متصل کنید.', 401);
    const pack = localPack.ensurePack('CDE', projectKey, { title: projectKey });
    flowId = flowId || 'ALL';
    const selected = String(body?.testFilePath || '').replace(/\\/g, '/');
    if (toolKind === 'DANGER') {
      testFilePath = selected && selected.endsWith('.mjs') ? selected : 'scripts/api/run.mjs';
      toolTarget = testFilePath;
    } else if (toolKind === 'K6') {
      testFilePath = selected && selected.endsWith('.js') ? selected : 'scripts/k6.js';
      toolTarget = path.basename(testFilePath);
    } else if (toolKind === 'PLAYWRIGHT') {
      testFilePath = selected && /\.(spec|test)\.(ts|js|mjs)$/i.test(selected) ? selected : 'scripts/e2e/health.spec.ts';
      toolTarget = testFilePath;
    } else {
      testFilePath = selected && /\.test\.(cjs|js)$/i.test(selected) ? selected : localPack.defaultUnitPath('CDE', projectKey);
      toolTarget = testFilePath;
    }
    sourceSnapshot = JSON.stringify({ approach: 'CDE', projectKey, toolKind, flowId, packRoot: pack.root });
    reportPaths.product = path.posix.join('runtime/packs/cde', localPack.safeKey(projectKey), 'reports');
  } else if (approach === 'GITHUB' || approach === 'GIT_EDUS') {
    const provider = approach;
    const connection = await loadConnection(pool, user.id, provider);
    if (!connection) throw new RunCreateError('SOURCE_NOT_CONNECTED', 'ابتدا حساب منبع را متصل کنید.', 401);
    if (!binding?.config?.remoteId) throw new RunCreateError('REMOTE_REQUIRED', 'ابتدا یک ریپوی کاربر را به پروژه وصل کنید.', 409);
    const remoteName = String(body?.packId || binding.config.fullName || 'repo').replace(/[\\/]/g, '_');
    const pack = localPack.ensurePack(provider, remoteName, { title: binding.config.fullName || remoteName });
    packId = localPack.safeKey(remoteName);
    flowId = flowId || 'ALL';
    const selected = String(body?.testFilePath || '').replace(/\\/g, '/');
    if (toolKind === 'DANGER') {
      testFilePath = selected && selected.endsWith('.mjs') ? selected : 'scripts/api/run.mjs';
      toolTarget = testFilePath;
    } else if (toolKind === 'K6') {
      testFilePath = selected && selected.endsWith('.js') ? selected : 'scripts/k6.js';
      toolTarget = path.basename(testFilePath);
    } else if (toolKind === 'PLAYWRIGHT') {
      testFilePath = selected && /\.(spec|test)\.(ts|js|mjs)$/i.test(selected) ? selected : 'scripts/e2e/health.spec.ts';
      toolTarget = testFilePath;
    } else {
      testFilePath = selected && /\.test\.(cjs|js)$/i.test(selected) ? selected : localPack.defaultUnitPath(provider, remoteName);
      toolTarget = testFilePath;
    }
    sourceSnapshot = JSON.stringify({
      approach: provider,
      remote: binding.config,
      toolKind,
      flowId,
      packRoot: pack.root,
      packKey: packId,
      boundUsername: connection.username,
    });
    reportPaths.product = path.posix.join('runtime/packs', provider.toLowerCase(), packId, 'reports');
  } else if (approach === 'ZIP') {
    if (!binding?.config?.root) throw new RunCreateError('ZIP_REQUIRED', 'ابتدا فایل زیپ را آپلود کنید.', 409);
    testFilePath = toolTarget || body?.testFilePath || '.';
    sourceSnapshot = JSON.stringify({ approach: 'ZIP', extracted: binding.config, toolKind });
  } else {
    throw new RunCreateError('UNSUPPORTED_APPROACH', 'این اپروچ هنوز برای اجرا پشتیبانی نمی‌شود.', 422);
  }

  const timeoutSeconds = Math.max(
    Number(body?.timeoutSeconds || settings.rows[0].default_timeout_seconds),
    toolKind === 'DANGER' && (!flowId || flowId === 'ALL') ? 1800
      : (approach === 'GITHUB' || approach === 'GIT_EDUS') && toolKind === 'PLAYWRIGHT' ? 1800
      : toolKind === 'K6' || toolKind === 'PLAYWRIGHT' ? 900 : 0,
  );
  const runValues = [
    projectId, environment.id, testFilePath, sourceSnapshot, browsers, Boolean(body?.headed),
    Number(body?.workers || settings.rows[0].default_workers), Number(body?.retries || settings.rows[0].default_retries),
    body?.maxFailures == null || body?.maxFailures === 'unlimited' ? null : Number(body.maxFailures),
    body?.trace || settings.rows[0].default_trace, body?.reporter || settings.rows[0].default_reporter,
    timeoutSeconds, user.id, approach, toolKind, toolTarget, packId, flowId, JSON.stringify(reportPaths),
  ];

  if (approach === 'CDE') {
    const live = await pool.query(
      `SELECT id, project_id, status, source_approach, tool_kind, pack_id, flow_id, test_file_path, cde_snapshot_id
         FROM runs
        WHERE requested_by=$1 AND source_approach='CDE' AND pack_id=$2 AND tool_kind=$3
          AND coalesce(test_file_path,'')=$4 AND status IN ('PREPARING','QUEUED','RUNNING')
        ORDER BY created_at DESC LIMIT 1`,
      [user.id, packId, toolKind, testFilePath],
    );
    if (live.rowCount) return live.rows[0];

    const refresh = body?.refreshSnapshot === true;
    if (!refresh) {
      const ready = await pool.query(
        `SELECT id, manifest FROM cde_source_snapshots
          WHERE status='READY' AND file_count>0 AND expires_at>now()
            AND updated_at > now() - interval '2 hours'
            AND manifest->>'projectKey'=$1
            AND EXISTS (SELECT 1 FROM cde_snapshot_files f WHERE f.snapshot_id=cde_source_snapshots.id)
          ORDER BY updated_at DESC LIMIT 1`,
        [packId],
      );
      if (ready.rowCount) {
        const result = await pool.query(
          `INSERT INTO runs (
              project_id,environment_id,test_file_path,source_snapshot,browser_projects,headed,workers,retries,
              max_failures,trace,reporter,timeout_seconds,requested_by,status,source_approach,tool_kind,tool_target,
              pack_id,flow_id,report_paths,cde_project_key,cde_snapshot_id,cde_manifest
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'QUEUED',$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22::jsonb)
           RETURNING *`,
          [...runValues, packId, ready.rows[0].id, JSON.stringify(ready.rows[0].manifest || { projectKey: packId, reused: true })],
        );
        await notifyRun(pool, result.rows[0].id);
        return result.rows[0];
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const snapshot = await client.query(
        `INSERT INTO cde_source_snapshots (project_id,requested_by,initiating_session_id,status,manifest)
         VALUES ($1,$2,$3,'PENDING',$4::jsonb) RETURNING id`,
        [projectId, user.id, user.sessionId, JSON.stringify({ requestedAt: new Date().toISOString(), projectKey: packId, toolKind })],
      );
      const result = await client.query(
        `INSERT INTO runs (
            project_id,environment_id,test_file_path,source_snapshot,browser_projects,headed,workers,retries,
            max_failures,trace,reporter,timeout_seconds,requested_by,status,source_approach,tool_kind,tool_target,
            pack_id,flow_id,report_paths,cde_project_key,cde_snapshot_id,logs
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PREPARING',$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22)
         RETURNING *`,
        [...runValues, packId, snapshot.rows[0].id, 'در حال دریافت سورس CDE و ساخت Snapshot. این مرحله خطا نیست و معمولاً حدود یک دقیقه طول می‌کشد.'],
      );
      await client.query('COMMIT');
      await notifyRun(pool, result.rows[0].id);
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const result = await pool.query(
    `INSERT INTO runs (
        project_id,environment_id,test_file_path,source_snapshot,browser_projects,headed,workers,retries,
        max_failures,trace,reporter,timeout_seconds,requested_by,status,source_approach,tool_kind,tool_target,
        pack_id,flow_id,report_paths
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'QUEUED',$14,$15,$16,$17,$18,$19::jsonb)
     RETURNING *`,
    runValues,
  );
  await notifyRun(pool, result.rows[0].id);
  return result.rows[0];
}

module.exports = { createApproachRun, RunCreateError, ensureEnvironment, ensureWorkspaceProject };
