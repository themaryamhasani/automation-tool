const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
const { createServer, pool } = require('./server.cjs');
const { startCdeSnapshotWorker } = require('./cde/snapshot-worker.cjs');
const { resolveEncryptionKey } = require('../../../shared/crypto-key.cjs');

resolveEncryptionKey();

const port = Number(process.env.API_PORT || 4280);
const server = createServer().listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'api-ready', port }));
});
const stopSnapshotWorker = startCdeSnapshotWorker(pool);

async function shutdown(signal) {
  console.log(JSON.stringify({ event: 'api-shutdown', signal }));
  stopSnapshotWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
