/**
 * Phase 4: typed source bindings (binding_cde / binding_is / binding_git / binding_zip).
 * Parent project_source_bindings.config stays as a synced camelCase mirror for API/create-run.
 */

const CHILD_TABLES = ['binding_cde', 'binding_is', 'binding_git', 'binding_zip'];

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function configFromCde(row) {
  if (!row) return {};
  return { packKey: row.pack_key, projectKey: row.pack_key, packId: row.pack_key };
}

function configFromIs(row) {
  if (!row) return {};
  return { packId: row.pack_id };
}

function configFromGit(row) {
  if (!row) return {};
  return {
    provider: row.provider,
    remoteId: row.remote_id,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    htmlUrl: row.html_url || '',
    cloneUrl: row.clone_url || '',
    boundBy: row.bound_by || undefined,
    boundUsername: row.bound_username || undefined,
  };
}

function configFromZip(row) {
  if (!row) return {};
  return {
    root: row.root_path,
    originalName: row.original_name || undefined,
    fileCount: row.file_count || 0,
    bytes: Number(row.bytes || 0),
    extractedAt: row.extracted_at ? new Date(row.extracted_at).toISOString() : undefined,
  };
}

function synthesizeConfig(approach, child) {
  if (approach === 'CDE') return configFromCde(child);
  if (approach === 'IS') return configFromIs(child);
  if (approach === 'GITHUB' || approach === 'GIT_EDUS') return configFromGit(child);
  if (approach === 'ZIP') return configFromZip(child);
  return {};
}

async function clearChildren(db, projectId) {
  for (const table of CHILD_TABLES) {
    await db.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
  }
}

async function loadChild(db, approach, projectId) {
  if (approach === 'CDE') {
    const result = await db.query('SELECT * FROM binding_cde WHERE project_id = $1', [projectId]);
    return result.rows[0] || null;
  }
  if (approach === 'IS') {
    const result = await db.query('SELECT * FROM binding_is WHERE project_id = $1', [projectId]);
    return result.rows[0] || null;
  }
  if (approach === 'GITHUB' || approach === 'GIT_EDUS') {
    const result = await db.query('SELECT * FROM binding_git WHERE project_id = $1', [projectId]);
    return result.rows[0] || null;
  }
  if (approach === 'ZIP') {
    const result = await db.query('SELECT * FROM binding_zip WHERE project_id = $1', [projectId]);
    return result.rows[0] || null;
  }
  return null;
}

async function writeChild(db, projectId, approach, config) {
  const cfg = asObject(config);
  if (approach === 'CDE') {
    const packKey = String(cfg.packKey || cfg.projectKey || cfg.packId || '').trim() || 'unknown';
    await db.query(
      `INSERT INTO binding_cde (project_id, pack_key)
       VALUES ($1, $2)
       ON CONFLICT (project_id) DO UPDATE SET pack_key = excluded.pack_key, updated_at = now()`,
      [projectId, packKey],
    );
    return synthesizeConfig(approach, { pack_key: packKey });
  }
  if (approach === 'IS') {
    const packId = String(cfg.packId || '').trim().toUpperCase() || 'UNKNOWN';
    await db.query(
      `INSERT INTO binding_is (project_id, pack_id)
       VALUES ($1, $2)
       ON CONFLICT (project_id) DO UPDATE SET pack_id = excluded.pack_id, updated_at = now()`,
      [projectId, packId],
    );
    return synthesizeConfig(approach, { pack_id: packId });
  }
  if (approach === 'GITHUB' || approach === 'GIT_EDUS') {
    const remoteId = String(cfg.remoteId || '').trim();
    const fullName = String(cfg.fullName || '').trim();
    if (!remoteId || !fullName) {
      const err = new Error('پروژه ریموت را انتخاب کنید.');
      err.code = 'REMOTE_REQUIRED';
      err.status = 422;
      throw err;
    }
    const row = {
      provider: approach,
      remote_id: remoteId,
      full_name: fullName,
      default_branch: String(cfg.defaultBranch || 'main').trim() || 'main',
      html_url: String(cfg.htmlUrl || ''),
      clone_url: String(cfg.cloneUrl || ''),
      bound_by: cfg.boundBy || null,
      bound_username: cfg.boundUsername || null,
    };
    await db.query(
      `INSERT INTO binding_git (
          project_id, provider, remote_id, full_name, default_branch, html_url, clone_url, bound_by, bound_username
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (project_id) DO UPDATE SET
         provider = excluded.provider,
         remote_id = excluded.remote_id,
         full_name = excluded.full_name,
         default_branch = excluded.default_branch,
         html_url = excluded.html_url,
         clone_url = excluded.clone_url,
         bound_by = excluded.bound_by,
         bound_username = excluded.bound_username,
         updated_at = now()`,
      [
        projectId,
        row.provider,
        row.remote_id,
        row.full_name,
        row.default_branch,
        row.html_url,
        row.clone_url,
        row.bound_by,
        row.bound_username,
      ],
    );
    return synthesizeConfig(approach, row);
  }
  if (approach === 'ZIP') {
    const rootPath = String(cfg.root || '').trim();
    if (!rootPath) {
      const err = new Error('ابتدا فایل زیپ را آپلود کنید.');
      err.code = 'ZIP_REQUIRED';
      err.status = 409;
      throw err;
    }
    const extractedAt = cfg.extractedAt ? new Date(cfg.extractedAt) : null;
    const row = {
      root_path: rootPath,
      original_name: cfg.originalName ? String(cfg.originalName).slice(0, 255) : null,
      file_count: Number(cfg.fileCount || 0),
      bytes: Number(cfg.bytes || 0),
      extracted_at: extractedAt && !Number.isNaN(extractedAt.getTime()) ? extractedAt : null,
    };
    await db.query(
      `INSERT INTO binding_zip (project_id, root_path, original_name, file_count, bytes, extracted_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id) DO UPDATE SET
         root_path = excluded.root_path,
         original_name = excluded.original_name,
         file_count = excluded.file_count,
         bytes = excluded.bytes,
         extracted_at = excluded.extracted_at,
         updated_at = now()`,
      [projectId, row.root_path, row.original_name, row.file_count, row.bytes, row.extracted_at],
    );
    return synthesizeConfig(approach, row);
  }
  return asObject(config);
}

async function getBinding(db, projectId) {
  const result = await db.query('SELECT * FROM project_source_bindings WHERE project_id = $1', [projectId]);
  if (!result.rowCount) return null;
  const parent = result.rows[0];
  const child = await loadChild(db, parent.source_approach, projectId);
  const config = child
    ? synthesizeConfig(parent.source_approach, child)
    : asObject(parent.config);
  return { ...parent, config };
}

async function upsertBinding(db, projectId, approach, config) {
  // Parent must exist before typed children (FK). Mirror config filled after child write.
  await db.query(
    `INSERT INTO project_source_bindings (project_id, source_approach, config, last_sync_at, last_sync_status)
     VALUES ($1, $2, '{}'::jsonb, now(), 'BOUND')
     ON CONFLICT (project_id) DO UPDATE SET
       source_approach = excluded.source_approach,
       last_sync_at = now(),
       last_sync_status = 'BOUND',
       updated_at = now()`,
    [projectId, approach],
  );
  await clearChildren(db, projectId);
  const mirrored = await writeChild(db, projectId, approach, config);
  const result = await db.query(
    `UPDATE project_source_bindings
        SET config = $2::jsonb, last_sync_at = now(), last_sync_status = 'BOUND', updated_at = now()
      WHERE project_id = $1
      RETURNING *`,
    [projectId, JSON.stringify(mirrored || {})],
  );
  await db.query('UPDATE projects SET source_approach = $1, updated_at = now() WHERE id = $2', [approach, projectId]);
  return { ...result.rows[0], config: mirrored };
}

function serializeBinding(row) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    sourceApproach: row.source_approach,
    config: asObject(row.config),
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
  };
}

module.exports = {
  CHILD_TABLES,
  getBinding,
  upsertBinding,
  serializeBinding,
  synthesizeConfig,
  configFromCde,
  configFromIs,
  configFromGit,
  configFromZip,
};
