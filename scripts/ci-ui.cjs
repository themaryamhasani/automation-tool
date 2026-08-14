const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const children = [];

function spawnNode(args, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd: extra.cwd || root,
    stdio: 'inherit',
    env: { ...process.env, ...(extra.env || {}) },
  });
  children.push(child);
  return child;
}

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Timeout waiting for ${url} (${last})`);
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

async function main() {
  spawnNode(['apps/api/src/main.cjs'], { env: { API_PORT: '4280' } });
  const viteCli = require.resolve('vite/bin/vite.js');
  spawnNode([viteCli, 'preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
    cwd: path.join(root, 'apps/web'),
  });
  await waitHttp('http://127.0.0.1:4280/api/health', 40_000);
  await waitHttp('http://127.0.0.1:5180', 40_000);
  const playwrightCli = require.resolve('@playwright/test/cli');
  const code = await new Promise(resolve => {
    const child = spawnNode([playwrightCli, 'test', '--config', 'playwright.ui.config.cjs']);
    child.on('exit', value => resolve(value == null ? 1 : value));
  });
  shutdown();
  process.exit(code);
}

process.on('SIGINT', () => { shutdown(); process.exit(1); });
process.on('SIGTERM', () => { shutdown(); process.exit(1); });
main().catch(error => {
  console.error(error);
  shutdown();
  process.exit(1);
});
