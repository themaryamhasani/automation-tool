const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { applySearchPath } = require('../shared/db/search-path.cjs');
const { loadRegistryMap, listPackTargetOverlays } = require('../shared/runtime/target-registry.cjs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function rowFromDef(packKey, def) {
  return {
    pack_key: packKey,
    title: def.title || packKey,
    preferred_origin: def.preferredOrigin || null,
    login_path: def.loginPath || null,
    app_path: def.appPath || null,
    project_service_id: def.projectServiceId || null,
    use_origin_host_as_service_id: Boolean(def.useOriginHostAsServiceId),
    auth_mode: def.authMode || 'devlogin',
    auth_profiles: def.authProfiles || {},
    role_landings: def.roleLandings || { default: '/' },
    api_fixtures: def.apiFixtures || {},
  };
}

async function upsertTarget(client, row) {
  await client.query(
    `INSERT INTO project_targets (
        pack_key, title, preferred_origin, login_path, app_path, project_service_id,
        use_origin_host_as_service_id, auth_mode, auth_profiles, role_landings, api_fixtures, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,now())
     ON CONFLICT (pack_key) DO UPDATE SET
       title=excluded.title,
       preferred_origin=excluded.preferred_origin,
       login_path=excluded.login_path,
       app_path=excluded.app_path,
       project_service_id=excluded.project_service_id,
       use_origin_host_as_service_id=excluded.use_origin_host_as_service_id,
       auth_mode=excluded.auth_mode,
       auth_profiles=excluded.auth_profiles,
       role_landings=excluded.role_landings,
       api_fixtures=excluded.api_fixtures,
       updated_at=now()`,
    [
      row.pack_key,
      row.title,
      row.preferred_origin,
      row.login_path,
      row.app_path,
      row.project_service_id,
      row.use_origin_host_as_service_id,
      row.auth_mode,
      JSON.stringify(row.auth_profiles || {}),
      JSON.stringify(row.role_landings || {}),
      JSON.stringify(row.api_fixtures || {}),
    ],
  );
}

async function syncProjectTargets(client) {
  const map = loadRegistryMap();
  for (const overlay of listPackTargetOverlays()) {
    const base = map[overlay.packKey] || {
      title: overlay.packKey,
      roleLandings: { default: '/' },
      apiFixtures: {},
      authProfiles: {},
    };
    map[overlay.packKey] = { ...base, ...overlay.target };
  }
  let count = 0;
  for (const [packKey, def] of Object.entries(map)) {
    await upsertTarget(client, rowFromDef(packKey, def));
    count += 1;
  }
  return count;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await applySearchPath(client);
  const count = await syncProjectTargets(client);
  await client.end();
  console.log(`Synced ${count} project targets.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { syncProjectTargets, upsertTarget, rowFromDef };
