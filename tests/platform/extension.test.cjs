const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createAuthenticate, ensureProjectAccess } = require('../../apps/api/src/middleware/auth.cjs');
const { authorizeApiTokenRequest, requireSession } = require('../../apps/api/src/auth/api-token.cjs');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('persisted Playwright runs pass POSIX test paths so Windows backslashes are not treated as RegExp', () => {
  const runner = fs.readFileSync(path.join(root, 'apps/runner/src/main.cjs'), 'utf8');
  const processModule = fs.readFileSync(path.join(root, 'apps/runner/src/process.cjs'), 'utf8');
  assert.match(runner, /path\.posix\.join\('tests'/);
  assert.match(runner, /Playwright CLI file args are treated as RegExp/);
  assert.match(processModule, /function persistedPlaywrightJob/);
  assert.match(runner, /persistedPlaywrightJob\(/);
  assert.match(processModule, /channel:/);
  assert.match(processModule, /NODE_PATH:/);
});

test('Chrome recorder is an isolated MV3 workspace backed by playwright-crx', () => {
  const pkg = JSON.parse(read('apps/extension/package.json'));
  const manifest = JSON.parse(read('apps/extension/public/manifest.json'));
  const background = read('apps/extension/src/background/playwright-service.ts');
  assert.equal(pkg.name, '@automation-tool/extension');
  assert.equal(pkg.dependencies['playwright-crx'], '0.15.0');
  assert.equal(pkg.devDependencies.vite, '6.4.3');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  for (const permission of ['debugger', 'tabs', 'storage', 'sidePanel', 'contextMenus', 'cookies']) assert.ok(manifest.permissions.includes(permission));
  for (const host of ['https://*.m.edus.ir/*', 'https://adib.m.edus.ir/*', 'https://soha.m.edus.ir/*']) {
    assert.ok(manifest.host_permissions.includes(host), `missing host_permissions ${host}`);
  }
  assert.match(background, /crx\.start\(/);
  assert.match(background, /app\.attach\(/);
  assert.match(background, /app\.recorder\.run\(/);
  assert.match(background, /lastFocusedWindow: true/);
  assert.match(background, /tracing\.start\(\{ screenshots: true, snapshots: true, sources: true \}\)/);
  assert.match(background, /resolveAttachTab/);
  assert.match(background, /Keep the CRX app alive/);
  assert.doesNotMatch(background, /this\.app = null;\s*\n\s*this\.appPromise = null;\s*\n\s*const detail = reason/);
});

test('side panel prefers live tab URL when not attached and validates live URL on Record', () => {
  const sidepanel = read('apps/extension/src/sidepanel/App.tsx');
  assert.match(sidepanel, /sessionOwnsTab/);
  assert.match(sidepanel, /currentTab\.url \|\| session\.tabUrl/);
  assert.match(sidepanel, /const liveUrl = focused\?\.url \|\| currentTab\.url/);
  assert.match(sidepanel, /window\.addEventListener\('focus'/);
});

test('extension integration reuses test_files and the single run creation path', () => {
  const client = read('apps/extension/src/api/client.ts');
  const sidepanel = read('apps/extension/src/sidepanel/App.tsx');
  const createRun = read('apps/api/src/runs/create-run.cjs');
  const runner = read('apps/runner/src/main.cjs');
  assert.match(client, /this\.request\('\/api\/files\/upsert'/);
  assert.match(client, /this\.request\('\/api\/runs'/);
  assert.match(sidepanel, /save-run/);
  assert.match(sidepanel, /className="splitter"/);
  assert.match(sidepanel, /Locator/);
  assert.match(sidepanel, />Log</);
  assert.match(sidepanel, /openWeb\(`\/runs\?runId=\$\{encodeURIComponent\(run\.id\)\}`\)/);
  assert.match(createRun, /createPersistedFileRun/);
  assert.match(runner, /persistedPlaywrightFile/);
});

test('extension Save & Run captures browser storageState for authenticated server runs', () => {
  const client = read('apps/extension/src/api/client.ts');
  const sidepanel = read('apps/extension/src/sidepanel/App.tsx');
  const background = read('apps/extension/src/background/index.ts');
  const service = read('apps/extension/src/background/playwright-service.ts');
  const cookies = read('apps/extension/src/background/chrome-cookies.ts');
  const vite = read('apps/extension/vite.config.ts');
  const createRun = read('apps/api/src/runs/create-run.cjs');
  const runner = read('apps/runner/src/main.cjs');
  assert.match(client, /browserStorageState/);
  assert.match(sidepanel, /EXPORT_STORAGE_STATE/);
  assert.match(background, /EXPORT_STORAGE_STATE/);
  assert.match(service, /storageState\(\)/);
  assert.match(service, /enrichStorageStateWithChromeCookies/);
  assert.match(cookies, /enrichStorageStateWithCdpCookies|Network\.getAllCookies/);
  assert.match(cookies, /assessBrowserSession/);
  assert.match(cookies, /soha\.m\.edus\.ir/);
  assert.match(service, /assessBrowserSession/);
  assert.match(service, /enrichStorageStateWithCdpCookies/);
  assert.match(vite, /https:\/\/\*\.m\.edus\.ir\/\*/);
  assert.match(vite, /soha\.medu\.ir/);
  assert.match(vite, /https:\/\/adib\.m\.edus\.ir\/\*/);
  assert.match(vite, /https:\/\/soha\.m\.edus\.ir\/\*/);
  assert.match(createRun, /encryptBrowserStorageState/);
  assert.match(createRun, /normalizeBrowserStorageState/);
  assert.match(runner, /materializeBrowserStorageState/);
  assert.match(runner, /preparePlaywrightEnv/);
  assert.match(runner, /clearEncryptedBrowserStorageState/);
});

test('extension token scopes include only required project, file and run capabilities', () => {
  const tokenModule = read('apps/api/src/auth/api-token.cjs');
  for (const scope of ['profile:read', 'projects:read', 'files:read', 'files:write', 'runs:create', 'runs:read']) {
    assert.ok(tokenModule.includes(`'${scope}'`));
  }
  assert.match(tokenModule, /SESSION_AUTH_REQUIRED/);
});

test('scoped atk bearer credentials authenticate without being treated as web sessions', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('UPDATE')) return { rowCount: 1, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          token_id: 'token-1',
          scopes: ['projects:read', 'files:write'],
          project_ids: ['project-1'],
          id: 'user-1',
          full_name: 'Extension User',
          email: 'extension@example.test',
          role: 'OPERATOR',
          is_active: true,
        }],
      };
    },
  };
  const req = {
    get: name => name.toLowerCase() === 'authorization' ? 'Bearer atk_raw_secret' : '',
  };
  let nextError;
  await createAuthenticate(pool)(req, {}, error => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.equal(req.authKind, 'api_token');
  assert.deepEqual(req.apiToken.projectIds, ['project-1']);
  assert.deepEqual(req.user.apiTokenProjectIds, ['project-1']);
  assert.equal(queries.length, 2);
  assert.notEqual(queries[0].params[0], 'atk_raw_secret');
});

test('API tokens cannot access session-only token management', () => {
  let nextError;
  requireSession({ apiToken: { id: 'token-1' } }, {}, error => { nextError = error; });
  assert.equal(nextError?.status, 403);
  assert.equal(nextError?.code, 'SESSION_AUTH_REQUIRED');
});

test('API token route policy allows declared scopes and denies unrelated admin routes', () => {
  const tokenRequest = (method, originalUrl, scopes) => ({ method, originalUrl, apiToken: { scopes } });
  let allowedError;
  authorizeApiTokenRequest(tokenRequest('GET', '/api/projects?active=1', ['projects:read']), {}, error => { allowedError = error; });
  assert.equal(allowedError, undefined);

  let deniedError;
  authorizeApiTokenRequest(tokenRequest('POST', '/api/projects', ['projects:read']), {}, error => { deniedError = error; });
  assert.equal(deniedError?.status, 403);
  assert.equal(deniedError?.code, 'TOKEN_SCOPE_DENIED');
});

test('an explicitly empty token project scope denies every project without querying it', async () => {
  let queryCount = 0;
  const pool = { query: async () => { queryCount += 1; return { rowCount: 1 }; } };
  await assert.rejects(
    ensureProjectAccess(pool, { id: 'user-1', role: 'ADMIN', apiTokenProjectIds: [] }, 'project-1'),
    error => error?.status === 403 && error?.code === 'PROJECT_ACCESS_DENIED',
  );
  assert.equal(queryCount, 0);
});
