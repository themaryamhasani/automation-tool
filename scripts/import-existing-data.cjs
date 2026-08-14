const crypto = require('node:crypto');
const path = require('node:path');
const argon2 = require('argon2');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const sourceUrl = process.env.SOURCE_DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/UTMS?schema=public';
const targetUrl = process.env.DATABASE_URL;

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.replace(/^\{|\}$/g, '').split(',').map(item => item.replace(/^"|"$/g, '').trim()).filter(Boolean);
}

function roleFor(assignments) {
  if (assignments.some(row => row.role === 'SYSTEM_ADMIN')) return 'ADMIN';
  if (assignments.some(row => ['QA_LEAD', 'QA_SPECIALIST'].includes(row.role))) return 'OPERATOR';
  return 'VIEWER';
}

function importedRunStatus(status) {
  if (['PASSED', 'FAILED', 'ERROR', 'CANCELLED'].includes(status)) return status;
  return 'ERROR';
}

async function main() {
  if (!targetUrl) throw new Error('DATABASE_URL is required.');
  if (new URL(sourceUrl).pathname === new URL(targetUrl).pathname) throw new Error('Source and target databases must be different.');
  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();

  async function mapped(type, sourceId) {
    if (!sourceId) return null;
    const result = await target.query('SELECT target_id FROM import_records WHERE source_type=$1 AND source_id=$2', [type, String(sourceId)]);
    return result.rows[0]?.target_id || null;
  }
  async function remember(type, sourceId, targetId) {
    await target.query(
      `INSERT INTO import_records (source_type,source_id,target_id) VALUES ($1,$2,$3)
       ON CONFLICT (source_type,source_id) DO UPDATE SET target_id=excluded.target_id,imported_at=now()`,
      [type, String(sourceId), targetId],
    );
  }

  const users = await source.query(
    `SELECT u.*, c.password_hash FROM users u LEFT JOIN user_credentials c ON c.user_id=u.id ORDER BY u.created_at`,
  );
  const assignments = (await source.query('SELECT * FROM user_role_assignments WHERE is_active=true')).rows;
  const assignmentApps = (await source.query('SELECT * FROM user_role_assignment_applications')).rows;
  const fallbackHash = await argon2.hash('ChangeMe@12345');
  for (const user of users.rows) {
    if (await mapped('user', user.id)) continue;
    const identity = await target.query(
      `SELECT id FROM users WHERE ($1::text IS NOT NULL AND lower(email)=lower($1)) OR ($2::text IS NOT NULL AND phone_number=$2) LIMIT 1`,
      [user.email, user.phone_number],
    );
    let targetId = identity.rows[0]?.id;
    if (!targetId) {
      targetId = crypto.randomUUID();
      const rows = assignments.filter(row => row.user_id === user.id);
      await target.query(
        `INSERT INTO users (id,full_name,email,phone_number,password_hash,role,is_active,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [targetId, user.full_name, user.email, user.phone_number, user.password_hash || fallbackHash, roleFor(rows), user.is_active, user.created_at, user.updated_at],
      );
    }
    await remember('user', user.id, targetId);
  }

  const applications = await source.query('SELECT * FROM applications ORDER BY created_at');
  for (const application of applications.rows) {
    if (await mapped('project', application.id)) continue;
    const existing = await target.query('SELECT id FROM projects WHERE lower(code)=lower($1)', [application.code]);
    const targetId = existing.rows[0]?.id || crypto.randomUUID();
    if (!existing.rowCount) {
      await target.query(
        `INSERT INTO projects (id,name,code,description,is_active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [targetId, application.name, String(application.code).toLowerCase(), application.description, application.is_active, application.created_at, application.updated_at],
      );
    }
    await remember('project', application.id, targetId);
  }

  const sourceMappings = await source.query('SELECT * FROM cde_application_mappings ORDER BY created_at');
  for (const mapping of sourceMappings.rows) {
    const projectId = await mapped('project', mapping.application_id);
    if (!projectId) continue;
    await target.query(
      `INSERT INTO cde_project_mappings (project_id,service_id,project_key,web_ui_repo_name,data_service_repo_name,api_module_repo_name,message_consumer_repo_name,test_repo_name,test_pack_id,enabled,last_validation_status,last_validated_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'automation_tool_test_files',$8,$9,$10,$11,$12,$13)
       ON CONFLICT (project_id) DO UPDATE SET service_id=excluded.service_id,project_key=excluded.project_key,web_ui_repo_name=excluded.web_ui_repo_name,data_service_repo_name=excluded.data_service_repo_name,api_module_repo_name=excluded.api_module_repo_name,message_consumer_repo_name=excluded.message_consumer_repo_name,test_repo_name=excluded.test_repo_name,test_pack_id=excluded.test_pack_id,enabled=excluded.enabled,last_validation_status=excluded.last_validation_status,last_validated_at=excluded.last_validated_at,updated_at=excluded.updated_at`,
      [projectId, mapping.service_id, mapping.project_key, mapping.web_ui_repo_name, mapping.data_service_repo_name, mapping.api_module_repo_name, mapping.message_consumer_repo_name, `playwright/${mapping.project_key}`, mapping.enabled, mapping.last_validation_status, mapping.last_validated_at, mapping.created_at, mapping.updated_at],
    );
  }

  const sourceSelections = await source.query('SELECT * FROM cde_branch_selections ORDER BY created_at');
  for (const selection of sourceSelections.rows) {
    const userId = await mapped('user', selection.user_id);
    const projectId = await mapped('project', selection.application_id);
    if (!userId || !projectId || selection.repository_type === 'TESTS') continue;
    await target.query(
      `INSERT INTO cde_branch_selections (user_id,project_id,repository_type,repo_name,pack_id,branch_kind,branch_rand_id,branch_index,last_seen_version_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id,project_id,repository_type,repo_name,pack_id) DO UPDATE SET branch_kind=excluded.branch_kind,branch_rand_id=excluded.branch_rand_id,branch_index=excluded.branch_index,last_seen_version_id=excluded.last_seen_version_id,updated_at=excluded.updated_at`,
      [userId, projectId, selection.repository_type, selection.repo_name, selection.pack_id, selection.branch_kind, selection.branch_rand_id, selection.branch_index, selection.last_seen_version_id, selection.created_at, selection.updated_at],
    );
  }

  for (const assignment of assignments) {
    const userId = await mapped('user', assignment.user_id);
    if (!userId) continue;
    const sourceProjectIds = new Set([assignment.application_id]);
    for (const item of assignmentApps.filter(row => row.assignment_id === assignment.id)) sourceProjectIds.add(item.application_id);
    for (const sourceProjectId of sourceProjectIds) {
      const projectId = await mapped('project', sourceProjectId);
      if (projectId) await target.query('INSERT INTO user_projects (user_id,project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, projectId]);
    }
  }

  const environments = await source.query('SELECT * FROM application_environments ORDER BY created_at');
  for (const environment of environments.rows) {
    const projectId = await mapped('project', environment.application_id);
    if (!projectId) continue;
    const alreadyMapped = await mapped('environment', environment.id);
    if (alreadyMapped) {
      await target.query(
        `UPDATE environments SET gateway_base_url=$1,secret_references=$2::jsonb,available_from=$3,available_until=$4 WHERE id=$5`,
        [environment.gateway_base_url, JSON.stringify(environment.secret_references || {}), environment.available_from, environment.available_until, alreadyMapped],
      );
      continue;
    }
    const existing = await target.query('SELECT id FROM environments WHERE project_id=$1 AND name=$2', [projectId, environment.name]);
    const targetId = existing.rows[0]?.id || crypto.randomUUID();
    if (!existing.rowCount) {
      await target.query(
        `INSERT INTO environments (id,project_id,name,base_url,api_base_url,gateway_base_url,secret_references,enabled,available_from,available_until,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
        [targetId, projectId, environment.name, environment.web_base_url, environment.api_base_url, environment.gateway_base_url, JSON.stringify(environment.secret_references || {}), environment.enabled, environment.available_from, environment.available_until, environment.created_at, environment.updated_at],
      );
    }
    await remember('environment', environment.id, targetId);
  }

  const files = await source.query('SELECT * FROM playwright_test_files ORDER BY created_at');
  for (const file of files.rows) {
    const projectId = await mapped('project', file.application_id);
    const createdBy = await mapped('user', file.created_by_id);
    if (!projectId || !createdBy) continue;
    const folderPath = String(file.folder_path || path.posix.dirname(file.full_path) || 'tests').replace(/^\/+|\/+$/g, '') || 'tests';
    const mapping = (await target.query('SELECT * FROM cde_project_mappings WHERE project_id=$1', [projectId])).rows[0];
    const cdeBinding = mapping ? {
      format: 1,
      serviceId: mapping.service_id,
      projectKey: mapping.project_key,
      repositories: { webUi: mapping.web_ui_repo_name, dataService: mapping.data_service_repo_name, apiModule: mapping.api_module_repo_name, messageConsumer: mapping.message_consumer_repo_name },
      playwrightStore: { provider: 'POSTGRESQL', repoName: mapping.test_repo_name, packId: mapping.test_pack_id },
      importedRemoteReference: file.cde_binding || null,
      capturedAt: new Date().toISOString(),
    } : null;
    const alreadyMapped = await mapped('test_file', file.id);
    if (alreadyMapped) {
      await target.query('UPDATE test_files SET cde_project_key=$1,cde_binding=$2::jsonb WHERE id=$3', [mapping?.project_key || null, JSON.stringify(cdeBinding), alreadyMapped]);
      continue;
    }
    const existing = await target.query('SELECT id FROM test_files WHERE project_id=$1 AND folder_path=$2 AND file_name=$3', [projectId, folderPath, file.file_name]);
    const targetId = existing.rows[0]?.id || crypto.randomUUID();
    if (!existing.rowCount) {
      const revision = Math.max(1, Number.parseInt(String(file.couch_revision || file.remote_version_id || '1'), 10) || 1);
      await target.query(
        `INSERT INTO test_files (id,project_id,folder_path,file_name,description,source_code,revision,created_by,updated_by,cde_project_key,cde_binding,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10::jsonb,$11,$12)`,
        [targetId, projectId, folderPath, file.file_name, file.description, file.script, revision, createdBy, mapping?.project_key || null, JSON.stringify(cdeBinding), file.created_at, file.updated_at],
      );
    }
    await remember('test_file', file.id, targetId);
  }

  const sourceSnapshots = await source.query('SELECT id,manifest,content_hash,status,error_code,error_message FROM cde_source_snapshots');
  const snapshotsById = new Map(sourceSnapshots.rows.map(snapshot => [snapshot.id, snapshot]));
  const runs = await source.query('SELECT * FROM playwright_runs ORDER BY created_at');
  for (const run of runs.rows) {
    if (await mapped('run', run.id)) continue;
    const projectId = await mapped('project', run.application_id);
    const requestedBy = await mapped('user', run.triggered_by_id);
    const testFileId = await mapped('test_file', run.test_file_id);
    let environmentId = await mapped('environment', run.environment_profile_id);
    if (!projectId || !requestedBy) continue;
    if (!environmentId) {
      const existing = await target.query('SELECT id FROM environments WHERE project_id=$1 AND name=$2', [projectId, run.environment || 'develop']);
      environmentId = existing.rows[0]?.id;
      if (!environmentId) {
        environmentId = crypto.randomUUID();
        await target.query(
          `INSERT INTO environments (id,project_id,name,base_url,enabled) VALUES ($1,$2,$3,'http://localhost',false)`,
          [environmentId, projectId, run.environment || 'develop'],
        );
      }
    }
    const file = testFileId ? await target.query('SELECT source_code FROM test_files WHERE id=$1', [testFileId]) : { rows: [] };
    const targetId = crypto.randomUUID();
    const sourceSnapshot = snapshotsById.get(run.snapshot_id);
    const projectMapping = (await target.query('SELECT project_key FROM cde_project_mappings WHERE project_id=$1', [projectId])).rows[0];
    await target.query(
      `INSERT INTO runs (id,project_id,environment_id,test_file_id,test_file_path,source_snapshot,browser_projects,headed,workers,retries,max_failures,trace,reporter,timeout_seconds,status,runner_id,command,logs,report,total_tests,passed_tests,failed_tests,skipped_tests,requested_by,requested_at,started_at,completed_at,duration_ms,last_heartbeat_at,cde_project_key,cde_manifest,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32,$33)`,
      [targetId, projectId, environmentId, testFileId, run.test_file_path, file.rows[0]?.source_code || '// Historical run: source snapshot was unavailable.',
        parseArray(run.projects).filter(item => ['chromium', 'firefox', 'webkit'].includes(item)), run.headed, Math.max(1, Number(run.workers) || 1), Math.max(0, Number(run.retries) || 0),
        run.max_failures === 'unlimited' ? null : Number(run.max_failures) || null, run.trace || 'retain-on-failure', ['json', 'html', 'junit'].includes(run.reporter) ? run.reporter : 'json',
        Number(run.timeout_seconds) || 120, importedRunStatus(run.status), run.runner_id, run.command, run.logs, run.report ? JSON.stringify(run.report) : null,
        run.total_tests, run.passed_tests, run.failed_tests, run.skipped_tests, requestedBy, run.requested_at || run.created_at, run.started_at, run.completed_at || run.updated_at,
        run.duration, run.last_heartbeat_at, projectMapping?.project_key || null, JSON.stringify(sourceSnapshot?.manifest || { importedSnapshot: sourceSnapshot || null }), run.created_at, run.updated_at],
    );
    await remember('run', run.id, targetId);
    await target.query(
      `INSERT INTO audit_logs (action,entity_type,entity_id,metadata) VALUES ('RUN_IMPORTED','RUN',$1,$2::jsonb)`,
      [targetId, JSON.stringify({ sourceId: run.id })],
    );
  }

  const counts = {};
  for (const table of ['users', 'projects', 'environments', 'test_files', 'runs']) {
    counts[table] = Number((await target.query(`SELECT count(*) AS total FROM ${table}`)).rows[0].total);
  }
  console.log(JSON.stringify({ imported: true, targetCounts: counts }, null, 2));
  await source.end();
  await target.end();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
