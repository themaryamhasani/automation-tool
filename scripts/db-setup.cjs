const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { applySearchPath } = require('../shared/db/search-path.cjs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function connectionUrl(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.search = '';
  return url.toString();
}

async function loadAppliedVersions(client) {
  try {
    await applySearchPath(client);
  } catch (_) {
    // Domains may not exist yet on a brand-new database.
  }
  try {
    const applied = await client.query('SELECT version FROM schema_migrations');
    return new Set(applied.rows.map((row) => row.version));
  } catch (_) {
    try {
      const applied = await client.query('SELECT version FROM public.schema_migrations');
      return new Set(applied.rows.map((row) => row.version));
    } catch (_) {
      try {
        const applied = await client.query('SELECT version FROM platform.schema_migrations');
        return new Set(applied.rows.map((row) => row.version));
      } catch (_) {
        return new Set();
      }
    }
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const targetUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(targetUrl.pathname.slice(1));
  if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) throw new Error('Database name contains unsupported characters.');

  const admin = new Client({ connectionString: connectionUrl(databaseUrl, 'postgres') });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    console.log(`Created database ${databaseName}.`);
  }
  await admin.end();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const migrationDirectory = path.resolve(__dirname, '..', 'database');
  const migrations = fs.readdirSync(migrationDirectory).filter(file => /^\d+.*\.sql$/.test(file)).sort();

  const appliedVersions = await loadAppliedVersions(client);

  for (const file of migrations) {
    const version = file.replace(/\.sql$/i, '');
    if (appliedVersions.has(version)) continue;
    await client.query(fs.readFileSync(path.join(migrationDirectory, file), 'utf8'));
    appliedVersions.add(version);
  }
  await applySearchPath(client);
  try {
    const { syncProjectTargets } = require('../scripts/sync-project-targets.cjs');
    const count = await syncProjectTargets(client);
    console.log(`Synced ${count} project targets.`);
  } catch (error) {
    console.warn(`project targets sync skipped: ${error.message}`);
  }
  await client.end();
  console.log('Database schema is ready.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
