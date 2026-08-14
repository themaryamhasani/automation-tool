const { createHash } = require('node:crypto');
const { assertLogicalSuccess, getDataSource } = require('./core-client.cjs');
const { getCdeSession, setCdeSession, deleteCdeSession } = require('./session-store.cjs');
const { compileDataServicePackage, normalizeSourcePath } = require('./data-service-compiler.cjs');
const { encryptText } = require('../../../../shared/snapshot-crypto.cjs');
const { shouldKeepRuntimePackage, savedIdsFor } = require('./snapshot-focus.cjs');
const { excerptLogs, notifyRun } = require('../../../../shared/log-excerpt.cjs');

const REPOSITORIES = {
  WEB_UI: { column: 'web_ui_repo_name', key: 'cde/repository/web-ui/list/fetch', root: 'web-ui' },
  DATA_SERVICE: { column: 'data_service_repo_name', key: 'cde/repository/data-service/list/fetch', root: 'data-service' },
  API_MODULE: { column: 'api_module_repo_name', key: 'cde/repository/api-module/list/fetch', root: 'api-module' },
  MESSAGE_CONSUMER: { column: 'message_consumer_repo_name', key: 'cde/repository/message-consumer/list/fetch', root: 'message-consumer' },
};
const MAX_SNAPSHOT_BYTES = Math.max(1024 * 1024, Number(process.env.CDE_SNAPSHOT_MAX_BYTES || 64 * 1024 * 1024));

function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function resultOf(response) { return response?.Result && typeof response.Result === 'object' ? response.Result : {}; }
function itemsOf(response) {
  const items = resultOf(response).items;
  if (!Array.isArray(items)) throw Object.assign(new Error('پاسخ CDE شامل آرایه items نبود.'), { code: 'CDE_SCHEMA_ERROR', status: 502 });
  return items;
}
function branchRows(item) {
  const rows = [];
  if (item?.public && typeof item.public === 'object' && Object.keys(item.public).length) rows.push({ selector: { kind: 'PUBLIC' }, versionId: item.public.versionId || null, value: item.public });
  (Array.isArray(item?.personal) ? item.personal : []).forEach((branch, index) => rows.push({
    selector: { kind: 'PERSONAL', ...(branch.rand_id ? { randId: String(branch.rand_id) } : {}), index: Number.isInteger(branch.index) ? branch.index : index },
    versionId: branch.versionId || null,
    value: branch,
  }));
  return rows;
}
function selectorMatches(branch, saved) {
  if (!saved || branch.selector.kind !== saved.branch_kind) return false;
  if (saved.branch_kind === 'PUBLIC') return true;
  return saved.branch_rand_id ? branch.selector.randId === saved.branch_rand_id : branch.selector.index === saved.branch_index;
}
function safePackage(value) { return encodeURIComponent(normalizeSourcePath(String(value || ''))); }
function addFile(files, paths, input) {
  const path = normalizeSourcePath(input.path);
  const folded = path.toLocaleLowerCase('en-US');
  if (paths.has(folded)) throw Object.assign(new Error(`تداخل مسیر در Snapshot: ${path}`), { code: 'CDE_PATH_COLLISION', status: 422 });
  paths.add(folded);
  const code = String(input.code ?? '');
  files.push({ ...input, path, code, sourceHash: hash(code) });
}
function remoteFiles(branch, type, packId) {
  if (type === 'API_MODULE') return [{ path: `${String(packId).replace(/^ds\//, '')}.js`, code: String(branch.value.actions || '') }];
  const files = branch.value?.content?.content;
  if (!Array.isArray(files)) throw Object.assign(new Error('شاخه انتخاب‌شده آرایه فایل سورس ندارد.'), { code: 'CDE_SCHEMA_ERROR', status: 502 });
  return files.map(file => ({ path: normalizeSourcePath(file.name), code: String(file.code ?? '') }));
}

async function reportProgress(pool, snapshot, info) {
  const message = String(info.message || 'در حال دریافت سورس CDE…').slice(0, 500);
  const patch = {
    phase: info.phase || 'fetch',
    repositoryType: info.repositoryType || null,
    packId: info.packId || null,
    packages: info.packages || 0,
    files: info.files || 0,
    message,
  };
  await pool.query(
    `UPDATE cde_source_snapshots SET manifest = coalesce(manifest,'{}'::jsonb) || $1::jsonb, updated_at=now() WHERE id=$2`,
    [JSON.stringify(patch), snapshot.id],
  );
  await pool.query(
    `UPDATE runs SET logs=$1, updated_at=now() WHERE id=$2 AND status='PREPARING'`,
    [excerptLogs(message), snapshot.run_id],
  );
  await notifyRun(pool, snapshot.run_id);
}

async function call(pool, sessionId, state, key, params = {}) {
  const result = await getDataSource(state, key, params);
  await setCdeSession(pool, sessionId, result.state);
  assertLogicalSuccess(result.response);
  if (resultOf(result.response).IsUserLogin === false) {
    await deleteCdeSession(pool, sessionId);
    throw Object.assign(new Error('نشست CDE منقضی شده است؛ دوباره متصل شوید.'), { code: 'CDE_RECONNECT_REQUIRED', status: 401 });
  }
  return result;
}

async function buildSnapshot(pool, snapshot) {
  let state = await getCdeSession(pool, snapshot.initiating_session_id);
  if (!state) throw Object.assign(new Error('نشست CDE سازندهٔ اجرا در دسترس نیست.'), { code: 'CDE_RECONNECT_REQUIRED', status: 409 });
  const mappingResult = await pool.query('SELECT * FROM cde_project_mappings WHERE project_id=$1 AND enabled=true', [snapshot.project_id]);
  const mapping = mappingResult.rows[0] || null;
  const projectKey = mapping?.project_key || snapshot.cde_project_key;
  if (!projectKey) throw Object.assign(new Error('کلید پروژه CDE برای Snapshot مشخص نیست.'), { code: 'CDE_PROJECT_REQUIRED', status: 409 });

  let response;
  ({ state, response } = await call(pool, snapshot.initiating_session_id, state, 'cde/repository/list/my-repo', {}));
  const accessible = itemsOf(response).map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (!accessible.includes(projectKey)) throw Object.assign(new Error('حساب متصل‌شده به این پروژه CDE دسترسی ندارد.'), { code: 'CDE_PROJECT_ACCESS_DENIED', status: 403 });

  const savedResult = await pool.query('SELECT * FROM cde_branch_selections WHERE user_id=$1 AND project_id=$2', [snapshot.requested_by, snapshot.project_id]);
  const savedSelections = savedResult.rows;
  const files = [];
  const packages = [];
  const warnings = [];
  const paths = new Set();
  let totalBytes = 0;
  const runtimeSnapshot = Boolean(snapshot.tool_kind);
  let apiKept = 0;
  let webKept = 0;

  for (const [type, config] of Object.entries(REPOSITORIES)) {
    if (runtimeSnapshot && (type === 'DATA_SERVICE' || type === 'MESSAGE_CONSUMER')) {
      warnings.push({ repositoryType: type, code: 'SKIPPED_FOR_RUNTIME', message: 'برای رانتایم Express فقط Web UI و API Module برداشته شد.' });
      continue;
    }
    const repoName = mapping?.[config.column] || `${projectKey}/${config.root}`;
    if (!repoName) continue;
    let listed;
    try {
      ({ state, response } = await call(pool, snapshot.initiating_session_id, state, config.key, { repoName }));
      listed = itemsOf(response);
    } catch (error) {
      if (type === 'DATA_SERVICE' || runtimeSnapshot) {
        warnings.push({ repositoryType: type, repoName, code: error.code || 'CDE_REPOSITORY_UNAVAILABLE', message: error.message });
        continue;
      }
      throw error;
    }
    if (type === 'DATA_SERVICE' && !listed.length) continue;
    const savedIds = runtimeSnapshot ? savedIdsFor(type, savedSelections) : null;
    for (const listedItem of listed) {
      const packId = String(listedItem?.id || listedItem?._id || listedItem || '');
      if (!packId) throw Object.assign(new Error(`پکیج بدون شناسه در ${repoName} دریافت شد.`), { code: 'CDE_PACKAGE_ID_MISSING', status: 502 });
      if (runtimeSnapshot) {
        const decision = shouldKeepRuntimePackage(type, packId, { savedIds, webKept, apiKept });
        if (!decision.keep) {
          warnings.push({ repositoryType: type, repoName, packId, code: decision.reason, message: `پکیج ${packId} برای Snapshot رانتایم حذف شد.` });
          continue;
        }
      }
      let item = listedItem;
      if (type !== 'API_MODULE') {
        try {
          ({ state, response } = await call(pool, snapshot.initiating_session_id, state, 'cde/package/any/one/fetch', { repoName, packId }));
          item = resultOf(response).pack;
        } catch (error) {
          if (!runtimeSnapshot) throw error;
          warnings.push({ repositoryType: type, repoName, packId, code: error.code || 'CDE_PACKAGE_FETCH_FAILED', message: error.message });
          continue;
        }
      }
      if (!item || typeof item !== 'object') {
        if (runtimeSnapshot) {
          warnings.push({ repositoryType: type, repoName, packId, code: 'CDE_PACKAGE_NOT_FOUND', message: `پکیج ${packId} از CDE دریافت نشد.` });
          continue;
        }
        throw Object.assign(new Error(`پکیج ${packId} از CDE دریافت نشد.`), { code: 'CDE_PACKAGE_NOT_FOUND', status: 404 });
      }
      const branches = branchRows(item);
      const saved = savedSelections.find(row => row.repository_type === type && row.repo_name === repoName && row.pack_id === packId);
      const selected = branches.find(branch => selectorMatches(branch, saved))
        || branches.find(branch => branch.selector.kind === 'PUBLIC')
        || (runtimeSnapshot ? branches[0] : null)
        || (branches.length === 1 ? branches[0] : null);
      if (!selected) {
        if (runtimeSnapshot) {
          warnings.push({ repositoryType: type, repoName, packId, code: 'BRANCH_SELECTION_REQUIRED', message: `برای پکیج ${packId} شاخه‌ای در دسترس نبود.` });
          continue;
        }
        throw Object.assign(new Error(`برای پکیج ${packId} شاخه عمومی/شخصی را انتخاب کنید.`), { code: 'BRANCH_SELECTION_REQUIRED', status: 409, details: { repositoryType: type, repoName, packId, branches: branches.map(branch => ({ selector: branch.selector, versionId: branch.versionId })) } });
      }
      if (runtimeSnapshot && type === 'API_MODULE') apiKept += 1;
      if (runtimeSnapshot && type === 'WEB_UI') webKept += 1;
      let packageFiles;
      try {
        packageFiles = remoteFiles(selected, type, packId);
      } catch (error) {
        if (!runtimeSnapshot) throw error;
        warnings.push({ repositoryType: type, repoName, packId, code: error.code || 'CDE_PACKAGE_SOURCE_INVALID', message: error.message });
        continue;
      }
      const manifestFiles = [];
      for (const file of packageFiles) {
        const target = `${config.root}/packages/${safePackage(packId)}/source/${file.path}`;
        addFile(files, paths, { path: target, code: file.code, repositoryType: type, repoName, packId, versionId: selected.versionId });
        totalBytes += Buffer.byteLength(file.code);
        manifestFiles.push({ path: target, sourceHash: hash(file.code) });
      }
      if (type === 'DATA_SERVICE') {
        const build = compileDataServicePackage(packageFiles.map(file => ({ name: file.path, code: file.code })));
        for (const file of build) {
          const target = `${config.root}/packages/${safePackage(packId)}/build/${file.name}`;
          addFile(files, paths, { path: target, code: file.build, repositoryType: 'DATA_SERVICE_BUILD', repoName, packId, versionId: selected.versionId });
          totalBytes += Buffer.byteLength(file.build);
          manifestFiles.push({ path: target, sourceHash: hash(file.build), compiled: true });
        }
      }
      packages.push({ repositoryType: type, repoName, packId, selector: selected.selector, versionId: selected.versionId, files: manifestFiles });
      if (totalBytes > MAX_SNAPSHOT_BYTES) throw Object.assign(new Error('حجم Snapshot CDE از سقف مجاز بیشتر شد.'), { code: 'CDE_SNAPSHOT_TOO_LARGE', status: 413 });
      if (type === 'WEB_UI' || packages.length === 1 || packages.length % 8 === 0) {
        await reportProgress(pool, snapshot, {
          phase: 'fetch',
          repositoryType: type,
          packId,
          packages: packages.length,
          files: files.length,
          message: `دریافت سورس CDE: ${packages.length} پکیج، ${files.length} فایل (${type}: ${packId})`,
        });
      }
    }
  }

  const testRows = await pool.query('SELECT id,folder_path,file_name,source_code,revision,cde_binding FROM test_files WHERE project_id=$1 ORDER BY folder_path,file_name', [snapshot.project_id]);
  const testManifest = [];
  for (const test of testRows.rows) {
    const relative = normalizeSourcePath(`${test.folder_path}/${test.file_name}`).replace(/^tests\//, '');
    const target = `tests/${relative}`;
    addFile(files, paths, { path: target, code: test.source_code, repositoryType: 'TESTS', repoName: mapping?.test_repo_name || `playwright/${projectKey}`, packId: mapping?.test_pack_id || `playwright/${projectKey}`, versionId: String(test.revision) });
    totalBytes += Buffer.byteLength(test.source_code);
    testManifest.push({ id: test.id, path: target, revision: test.revision, sourceHash: hash(test.source_code), binding: test.cde_binding || null });
    if (totalBytes > MAX_SNAPSHOT_BYTES) throw Object.assign(new Error('حجم Snapshot CDE از سقف مجاز بیشتر شد.'), { code: 'CDE_SNAPSHOT_TOO_LARGE', status: 413 });
  }
  packages.push({ repositoryType: 'TESTS', storage: 'POSTGRESQL', repoName: mapping?.test_repo_name || `playwright/${projectKey}`, packId: mapping?.test_pack_id || `playwright/${projectKey}`, versionId: hash(JSON.stringify(testManifest)), files: testManifest });
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    format: 2,
    serviceId: mapping?.service_id || 'cde.edus.ir',
    projectId: snapshot.project_id,
    projectKey,
    capturedAt: new Date().toISOString(),
    environment: { id: snapshot.environment_id, name: snapshot.environment_name, webBaseUrl: snapshot.base_url, apiBaseUrl: snapshot.api_base_url, gatewayBaseUrl: snapshot.gateway_base_url, availability: { from: snapshot.available_from, until: snapshot.available_until } },
    packages,
    warnings,
    fileCount: files.length,
    totalBytes,
  };
  const contentHash = hash(JSON.stringify({ manifest, files: files.map(file => ({ path: file.path, sourceHash: file.sourceHash })) }));
  return { files, manifest: { ...manifest, contentHash }, contentHash };
}

async function claim(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT s.*,r.id AS run_id,r.environment_id,r.cde_project_key,r.tool_kind,r.source_approach,e.name AS environment_name,e.base_url,e.api_base_url,e.gateway_base_url,e.available_from,e.available_until
         FROM cde_source_snapshots s JOIN runs r ON r.cde_snapshot_id=s.id JOIN environments e ON e.id=r.environment_id
        WHERE s.status='PENDING' AND r.status='PREPARING' ORDER BY s.created_at
        FOR UPDATE OF s SKIP LOCKED LIMIT 1`,
    );
    if (!result.rowCount) { await client.query('COMMIT'); return null; }
    await client.query("UPDATE cde_source_snapshots SET status='MATERIALIZING',updated_at=now() WHERE id=$1", [result.rows[0].id]);
    await client.query(
      "UPDATE runs SET logs=$1, updated_at=now() WHERE id=$2 AND status='PREPARING'",
      ['در حال دریافت سورس از CDE. این مرحله خطا نیست و معمولاً حدود یک دقیقه طول می‌کشد.', result.rows[0].run_id],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function complete(pool, snapshot, bundle) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM cde_snapshot_files WHERE snapshot_id=$1', [snapshot.id]);
    const chunkSize = 40;
    for (let index = 0; index < bundle.files.length; index += chunkSize) {
      const chunk = bundle.files.slice(index, index + chunkSize);
      const params = [];
      const placeholders = chunk.map((file, offset) => {
        const n = offset * 8;
        params.push(snapshot.id, file.path, encryptText(file.code), file.sourceHash, file.repositoryType, file.repoName || null, file.packId || null, file.versionId || null);
        return `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8})`;
      });
      await client.query(
        `INSERT INTO cde_snapshot_files (snapshot_id,path,encrypted_source,source_hash,repository_type,repo_name,pack_id,version_id)
         VALUES ${placeholders.join(',')}`,
        params,
      );
      if (index === 0 || index + chunkSize >= bundle.files.length || index % 200 === 0) {
        await client.query(
          "UPDATE runs SET logs=$1, updated_at=now() WHERE id=$2 AND status='PREPARING'",
          [`در حال ذخیره Snapshot: ${Math.min(index + chunk.length, bundle.files.length)} از ${bundle.files.length} فایل`, snapshot.run_id],
        );
      }
    }
    await client.query(
      `UPDATE cde_source_snapshots SET status='READY',manifest=$1::jsonb,content_hash=$2,file_count=$3,initiating_session_id=NULL,error_code=NULL,error_message=NULL,updated_at=now() WHERE id=$4`,
      [JSON.stringify(bundle.manifest), bundle.contentHash, bundle.files.length, snapshot.id],
    );
    await client.query("UPDATE runs SET status='QUEUED',cde_manifest=$1::jsonb,updated_at=now() WHERE id=$2 AND status='PREPARING'", [JSON.stringify(bundle.manifest), snapshot.run_id]);
    await client.query("INSERT INTO audit_logs (action,entity_type,entity_id,metadata) VALUES ('CDE_SNAPSHOT_READY','RUN',$1,$2::jsonb)", [snapshot.run_id, JSON.stringify({ snapshotId: snapshot.id, contentHash: bundle.contentHash, fileCount: bundle.files.length })]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function fail(pool, snapshot, error) {
  const code = String(error.code || 'CDE_SNAPSHOT_FAILED').slice(0, 120);
  const message = String(error.message || 'ساخت Snapshot CDE ناموفق بود.').slice(0, 4000);
  await pool.query(
    `WITH failed AS (
       UPDATE cde_source_snapshots SET status='FAILED',error_code=$1,error_message=$2,updated_at=now() WHERE id=$3
     ) UPDATE runs SET status='ERROR',logs=$4,completed_at=now(),updated_at=now() WHERE id=$5 AND status='PREPARING'`,
    [code, message, snapshot.id, `CDE snapshot failed [${code}]: ${message}`, snapshot.run_id],
  );
}

function startCdeSnapshotWorker(pool) {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const snapshot = await claim(pool);
      if (snapshot) {
        try { await complete(pool, snapshot, await buildSnapshot(pool, snapshot)); }
        catch (error) { await fail(pool, snapshot, error); }
      }
      await pool.query("UPDATE cde_source_snapshots SET status='PENDING',updated_at=now() WHERE status='MATERIALIZING' AND updated_at < now() - interval '20 minutes'");
      await pool.query("WITH expired AS (UPDATE cde_source_snapshots SET status='PURGED',purged_at=now(),updated_at=now() WHERE expires_at<=now() AND purged_at IS NULL RETURNING id) DELETE FROM cde_snapshot_files f USING expired e WHERE f.snapshot_id=e.id");
    } finally { busy = false; }
  };
  void tick().catch(error => console.error(JSON.stringify({ event: 'cde-snapshot-worker-error', message: error.message })));
  const timer = setInterval(() => void tick().catch(error => console.error(JSON.stringify({ event: 'cde-snapshot-worker-error', message: error.message }))), 1500);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { startCdeSnapshotWorker };
