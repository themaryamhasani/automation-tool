/**
 * Domain schemas (phase-1 layout). Unqualified SQL resolves via this path.
 * Order: hot catalog/exec first, then supporting domains, public last.
 */
const { Pool } = require('pg');

const DOMAIN_SCHEMAS = [
  'catalog',
  'exec',
  'iam',
  'source',
  'cde',
  'automation',
  'quality',
  'platform',
  'audit',
];

const SEARCH_PATH = `${DOMAIN_SCHEMAS.join(', ')}, public`;

const SET_SEARCH_PATH_SQL = `SET search_path TO ${DOMAIN_SCHEMAS.join(', ')}, public`;

/** Startup GUC so the first query on a connection already sees domain schemas. */
const SEARCH_PATH_OPTIONS = `-c search_path=${DOMAIN_SCHEMAS.join(',')},public`;

function createPool(connectionString) {
  return new Pool({
    connectionString,
    options: SEARCH_PATH_OPTIONS,
  });
}

/**
 * Prefer createPool(). Kept for callers that already constructed a Pool;
 * attaches a connect hook (may race — createPool is safer).
 */
function configurePool(pool) {
  if (!pool || typeof pool.on !== 'function') return pool;
  if (pool.__automationSearchPathConfigured) return pool;
  pool.__automationSearchPathConfigured = true;
  pool.on('connect', (client) => {
    client.query(SET_SEARCH_PATH_SQL).catch((error) => {
      console.error(JSON.stringify({ event: 'db-search-path-failed', message: error.message }));
    });
  });
  return pool;
}

async function applySearchPath(client) {
  await client.query(SET_SEARCH_PATH_SQL);
  return client;
}

module.exports = {
  DOMAIN_SCHEMAS,
  SEARCH_PATH,
  SET_SEARCH_PATH_SQL,
  SEARCH_PATH_OPTIONS,
  createPool,
  configurePool,
  applySearchPath,
};
