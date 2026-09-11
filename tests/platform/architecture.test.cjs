const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { applySearchPath, DOMAIN_SCHEMAS } = require('../../shared/db/search-path.cjs');

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'runtime', 'artifacts'].includes(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(target));
    else if (/\.(?:js|cjs|mjs|ts|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

test('runtime source has no imports from the parent application', () => {
  const root = path.resolve(__dirname, '..', '..');
  const runtimeFiles = [...sourceFiles(path.join(root, 'apps')), ...sourceFiles(path.join(root, 'shared'))];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@utms\//i, file);
    assert.doesNotMatch(source, /UTMS-MASTER/i, file);
    assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/UTMS/i, file);
  }
});

test('database connection points at the isolated database and core tables exist', async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(decodeURIComponent(url.pathname.slice(1)), 'automation-tool');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await applySearchPath(client);
    const database = await client.query('SELECT current_database() AS name');
    assert.equal(database.rows[0].name, 'automation-tool');
    const schemas = await client.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
      [DOMAIN_SCHEMAS],
    );
    assert.equal(schemas.rowCount, DOMAIN_SCHEMAS.length);
    const expected = [
      ['iam', 'users'],
      ['iam', 'sessions'],
      ['catalog', 'projects'],
      ['catalog', 'environments'],
      ['catalog', 'test_files'],
      ['exec', 'runs'],
      ['exec', 'run_requests'],
      ['exec', 'run_sources'],
      ['exec', 'run_logs'],
      ['exec', 'run_results'],
      ['exec', 'run_scm'],
      ['exec', 'artifacts'],
      ['exec', 'runner_settings'],
      ['audit', 'audit_logs'],
      ['cde', 'cde_sessions'],
      ['cde', 'cde_project_mappings'],
      ['cde', 'cde_branch_selections'],
      ['cde', 'cde_source_snapshots'],
      ['cde', 'cde_snapshot_files'],
      ['source', 'user_source_connections'],
      ['source', 'project_source_bindings'],
      ['source', 'binding_cde'],
      ['source', 'binding_is'],
      ['source', 'binding_git'],
      ['source', 'binding_zip'],
      ['catalog', 'project_targets'],
      ['exec', 'runtime_sessions'],
    ];
    const tables = await client.query(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE (table_schema, table_name) IN (
         SELECT * FROM unnest($1::text[], $2::text[]) AS t(schema_name, table_name)
       )`,
      [expected.map((row) => row[0]), expected.map((row) => row[1])],
    );
    assert.equal(tables.rowCount, expected.length);
    const stillPublic = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [expected.map((row) => row[1])],
    );
    assert.equal(stillPublic.rowCount, 0);
  } finally { await client.end(); }
});

test('zip and local test workspaces expose create mkdir and delete routes', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/approaches/routes.cjs'), 'utf8');
  const zipUi = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/ZipWorkspace.tsx'), 'utf8');
  const tree = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/studio.tsx'), 'utf8');
  assert.match(routes, /app\.put\('\/api\/projects\/:projectId\/zip\/file'/);
  assert.match(routes, /app\.post\('\/api\/projects\/:projectId\/zip\/dir'/);
  assert.match(routes, /app\.delete\('\/api\/projects\/:projectId\/zip\/entry'/);
  assert.match(routes, /app\.delete\('\/api\/approaches\/is\/entry'/);
  assert.match(routes, /app\.delete\('\/api\/runtime\/packs\/:approach\/:packKey\/entry'/);
  assert.match(zipUi, /onDelete=/);
  assert.match(zipUi, /CreateFolderDialog/);
  assert.match(tree, /onDelete\?: \(entry: DirEntry\) => void/);
});

test('workspace UI waits for requests before showing empty or missing states', () => {
  const tree = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/studio.tsx'), 'utf8');
  const zip = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/ZipWorkspace.tsx'), 'utf8');
  const isStudio = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/IsStudio.tsx'), 'utf8');
  const cdeStudio = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/CdeStudio.tsx'), 'utf8');
  const gitStudio = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/GitStudio.tsx'), 'utf8');
  const cdeWs = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/CdeWorkspace.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/pages/WorkspacePage.tsx'), 'utf8');
  assert.match(tree, /loading\?: boolean/);
  assert.match(tree, /loading\s*\n\s*\? <Loading/);
  assert.match(zip, /boot \? <Loading text="در حال خواندن آرشیو/);
  assert.match(isStudio, /loading=\{treeLoading\}/);
  assert.match(cdeStudio, /loading=\{treeLoading\}/);
  assert.match(gitStudio, /loading=\{treeLoading\}/);
  assert.match(cdeWs, /در حال بررسی نشست CDE/);
  assert.match(workspace, /در حال آماده‌سازی پروژه/);
});

test('create-file dialog is editable and exposes OpenAPI/custom artifacts', () => {
  const studio = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/studio.tsx'), 'utf8');
  const projectsPage = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/pages/ProjectsPage.tsx'), 'utf8');
  const server = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/server.cjs'), 'utf8');
  assert.match(studio, /متن فایل — قابل ویرایش/);
  assert.match(studio, /<CodeEditor value=\{source\} onChange=\{setSource\}/);
  assert.doesNotMatch(studio, /<CodeEditor value=\{preview\} readOnly/);
  assert.match(studio, /'openapi', 'custom'/);
  assert.match(studio, /id: 'custom'/);
  assert.match(server, /app\.delete\('\/api\/projects\/:id'/);
  assert.match(server, /PROJECT_DELETED/);
  assert.match(projectsPage, /حذف سامانه/);
  assert.match(projectsPage, /removeProject/);
});

test('GitHub checkout is copied into the run workspace instead of mutating a sibling folder', () => {
  const tools = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/runner/src/tools.cjs'), 'utf8');
  assert.match(tools, /isolateSiblingCheckout/);
  assert.match(tools, /workspace, 'checkout'/);
  assert.doesNotMatch(tools, /ensureNpmInstall\(sibling/);
});

test('run list and detail queries never select r.* or full source_snapshot', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/runs/routes.cjs'), 'utf8');
  const server = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/server.cjs'), 'utf8');
  const createRun = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/runs/create-run.cjs'), 'utf8');
  const runner = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  assert.doesNotMatch(routes, /SELECT r\.\*/);
  assert.doesNotMatch(server, /SELECT r\.\*/);
  assert.doesNotMatch(runner, /SELECT r\.\*/);
  assert.match(routes, /RUN_EVENT_COLUMNS/);
  assert.match(routes, /\/api\/runs\/:id\/events/);
  assert.match(routes, /\/api\/runs\/:id\/logs/);
  assert.match(server, /registerRunRoutes/);
  assert.match(createRun, /createPersistedFileRun/);
  assert.match(createRun, /testFileId/);
});

test('management reports live in reports modules and never select r.*', () => {
  const root = path.resolve(__dirname, '..', '..');
  const server = fs.readFileSync(path.join(root, 'apps/api/src/server.cjs'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'apps/api/src/reports/routes.cjs'), 'utf8');
  const queries = fs.readFileSync(path.join(root, 'apps/api/src/reports/queries.cjs'), 'utf8');
  const catalog = fs.readFileSync(path.join(root, 'apps/api/src/reports/catalog.cjs'), 'utf8');
  const webApp = fs.readFileSync(path.join(root, 'apps/web/src/App.tsx'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'apps/web/src/components/Layout.tsx'), 'utf8');
  assert.match(server, /registerReportRoutes/);
  assert.doesNotMatch(server, /app\.(get|post)\('\/api\/reports/);
  assert.match(routes, /\/api\/reports\/:id\/excel/);
  assert.match(catalog, /id: 'executive'/);
  assert.match(catalog, /id: 'engineering'/);
  assert.match(catalog, /id: 'quality'/);
  assert.match(catalog, /id: 'team'/);
  assert.match(catalog, /id: 'security'/);
  assert.match(catalog, /id: 'runs'/);
  assert.doesNotMatch(queries, /SELECT r\.\*/);
  assert.doesNotMatch(queries, /SELECT \*/);
  assert.doesNotMatch(routes, /SELECT r\.\*/);
  assert.match(webApp, /path="\/reports"/);
  assert.match(layout, /گزارشات/);
});

test('imported Playwright files use the standalone PostgreSQL CDE binding', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await applySearchPath(client);
    const rows = await client.query("SELECT cde_project_key,cde_binding FROM test_files WHERE cde_binding IS NOT NULL");
    if (!rows.rowCount) return;
    for (const row of rows.rows) {
      assert.ok(row.cde_project_key);
      assert.equal(row.cde_binding.playwrightStore.provider, 'POSTGRESQL');
      assert.equal(row.cde_binding.playwrightStore.repoName, 'automation_tool_test_files');
    }
  } finally { await client.end(); }
});

test('CDE snapshot dependency resolution lives outside server.cjs', () => {
  const root = path.resolve(__dirname, '..', '..');
  const server = fs.readFileSync(path.join(root, 'apps/api/src/server.cjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'apps/api/src/cde/snapshot-worker.cjs'), 'utf8');
  const deps = fs.readFileSync(path.join(root, 'apps/api/src/cde/snapshot-deps.cjs'), 'utf8');
  assert.doesNotMatch(server, /expandSnapshotDependencies|collectDependencySpecs/);
  assert.match(worker, /expandSnapshotDependencies/);
  assert.match(worker, /snapshot-deps\.cjs/);
  assert.match(deps, /function collectDependencySpecs/);
  assert.match(deps, /function resolveDependency/);
  assert.equal(fs.existsSync(path.join(root, 'tests/approaches/snapshot-deps.test.cjs')), true);
});

test('quality tools live in runner and create-run, not server.cjs', () => {
  const root = path.resolve(__dirname, '..', '..');
  const server = fs.readFileSync(path.join(root, 'apps/api/src/server.cjs'), 'utf8');
  const tools = fs.readFileSync(path.join(root, 'apps/runner/src/tools.cjs'), 'utf8');
  const createRun = fs.readFileSync(path.join(root, 'apps/api/src/runs/create-run.cjs'), 'utf8');
  const studio = fs.readFileSync(path.join(root, 'apps/web/src/components/studio.tsx'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'database/006_quality_tools.sql'), 'utf8');
  const migration005 = fs.readFileSync(path.join(root, 'database/005_source_approaches.sql'), 'utf8');
  const migration011 = fs.readFileSync(path.join(root, 'database/011_domain_schemas.sql'), 'utf8');
  const migration012 = fs.readFileSync(path.join(root, 'database/012_run_split.sql'), 'utf8');
  const migration013 = fs.readFileSync(path.join(root, 'database/013_project_targets.sql'), 'utf8');
  const migration014 = fs.readFileSync(path.join(root, 'database/014_binding_normalize.sql'), 'utf8');
  const migration015 = fs.readFileSync(path.join(root, 'database/015_runtime_session_scope.sql'), 'utf8');
  const migration016 = fs.readFileSync(path.join(root, 'database/016_project_kind.sql'), 'utf8');
  const migration017 = fs.readFileSync(path.join(root, 'database/017_pack_id_widen.sql'), 'utf8');
  const dbSetup = fs.readFileSync(path.join(root, 'scripts/db-setup.cjs'), 'utf8');
  const searchPath = fs.readFileSync(path.join(root, 'shared/db/search-path.cjs'), 'utf8');
  const runStore = fs.readFileSync(path.join(root, 'shared/db/run-store.cjs'), 'utf8');
  const bindings = fs.readFileSync(path.join(root, 'shared/db/bindings.cjs'), 'utf8');
  const sessionStore = fs.readFileSync(path.join(root, 'shared/runtime/session-store.cjs'), 'utf8');
  const projectKind = fs.readFileSync(path.join(root, 'shared/db/project-kind.cjs'), 'utf8');
  const scaffold = fs.readFileSync(path.join(root, 'scripts/lib/cde-pack-scaffold.cjs'), 'utf8');
  const appTargets = fs.readFileSync(path.join(root, 'shared/runtime/app-targets.cjs'), 'utf8');
  const { TOOL_IDS } = require('../../shared/approaches/constants.cjs');
  assert.equal(fs.existsSync(path.join(root, 'apps/runner/src/quality-tools.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'apps/runner/src/playwright-env.cjs')), true);
  assert.match(tools, /require\('\.\/quality-tools\.cjs'\)/);
  assert.match(tools, /require\('\.\/playwright-env\.cjs'\)/);
  assert.match(createRun, /needsLiveRuntime/);
  assert.match(createRun, /resolveToolTarget/);
  assert.doesNotMatch(server, /gitleaks|semgrep|spectral-cli/);
  assert.match(studio, /id: 'BIOME'/);
  assert.match(studio, /id: 'GITLEAKS'/);
  assert.match(migration, /GITLEAKS/);
  assert.match(migration, /SPECTRAL/);
  for (const toolId of TOOL_IDS) {
    assert.match(migration005, new RegExp(`'${toolId}'`));
    assert.match(migration, new RegExp(`'${toolId}'`));
  }
  assert.match(dbSetup, /schema_migrations/);
  assert.match(dbSetup, /appliedVersions\.has\(version\)/);
  assert.match(dbSetup, /applySearchPath/);
  assert.match(dbSetup, /syncProjectTargets/);
  assert.match(server, /createPool/);
  assert.match(server, /warmTargetsFromDb/);
  assert.match(searchPath, /DOMAIN_SCHEMAS/);
  assert.match(searchPath, /SEARCH_PATH_OPTIONS/);
  assert.match(migration011, /CREATE SCHEMA IF NOT EXISTS catalog/);
  assert.match(migration011, /ALTER TABLE IF EXISTS public\.runs SET SCHEMA exec/);
  assert.match(migration011, /ALTER DATABASE/);
  assert.match(migration012, /exec\.run_requests/);
  assert.match(migration013, /catalog\.project_targets/);
  assert.match(migration014, /source\.binding_git/);
  assert.match(migration014, /source\.binding_zip/);
  assert.match(migration015, /PRIMARY KEY \(user_id, environment_id, pack_key\)/);
  assert.match(migration016, /kind varchar\(20\)/);
  assert.match(migration016, /WORKSPACE/);
  assert.match(migration017, /pack_id TYPE varchar\(120\)/);
  assert.match(sessionStore, /pack_key/);
  assert.match(projectKind, /PROJECT_KIND_WORKSPACE/);
  assert.match(createRun, /PROJECT_KIND_WORKSPACE/);
  assert.match(scaffold, /scaffoldCdePack/);
  assert.match(bindings, /upsertBinding/);
  assert.match(bindings, /binding_cde/);
  assert.match(createRun, /shared\/db\/bindings\.cjs/);
  assert.match(runStore, /insertRun/);
  assert.match(createRun, /insertRun/);
  assert.doesNotMatch(appTargets, /const APP_TARGETS\s*=\s*\{/);
  assert.match(appTargets, /loadMergedTargets|targets-registry/);
  assert.equal(fs.existsSync(path.join(root, 'tests/platform')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/approaches')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/approaches/bindings.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/approaches/runtime-session-scope.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/platform/project-kind.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/platform/data-model-phases.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/packs/pack-contract.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/packs/pack-scaffold.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts/run-tests.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/medu-camp-pack.test.cjs')), false);
  assert.equal(fs.existsSync(path.join(root, 'shared/runtime/targets-registry.json')), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(String(pkg.scripts?.test || ''), /run-tests\.cjs/);
  assert.match(String(pkg.scripts?.['seed:pack'] || ''), /seed-cde-pack/);
});
