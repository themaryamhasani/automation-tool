const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const root = path.resolve(__dirname, '..');
const composeFile = path.join(root, 'docker-compose.yml');
const timeoutMs = Number(process.env.DOCKER_SMOKE_TIMEOUT_MS || 420_000);

process.env.CDE_SESSION_ENCRYPTION_KEY = process.env.CDE_SESSION_ENCRYPTION_KEY
  || 'ci-automation-tool-encryption-key-32chars';
process.env.RUNTIME_SESSION_ENCRYPTION_KEY = process.env.RUNTIME_SESSION_ENCRYPTION_KEY
  || process.env.CDE_SESSION_ENCRYPTION_KEY;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  });
}

async function waitForHealth(url, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok') return body;
      }
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Health check timed out: ${url}`);
}

async function main() {
  const apiPort = process.env.API_PORT || '4280';
  const healthUrl = `http://127.0.0.1:${apiPort}/api/health`;
  console.log(JSON.stringify({ event: 'docker-smoke-start' }));
  await run('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans']);
  await run('docker', ['compose', '-f', composeFile, 'up', '--build', '-d']);
  try {
    const body = await waitForHealth(healthUrl, Date.now() + timeoutMs);
    assert.equal(body.service, 'automation-api');
    console.log(JSON.stringify({ event: 'docker-smoke-pass', health: body }));
  } finally {
    await run('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans']).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'docker-smoke-fail', message: error.message }));
  process.exitCode = 1;
});
