const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const result = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', path.join(root, 'playwright.ui.config.cjs')],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1', FORCE_COLOR: '0' } },
);
process.exitCode = result.status ?? 1;
