#!/usr/bin/env node
/**
 * Discover tests under tests/{platform,approaches,packs} and run with node --test.
 * Node's --test does not load directory args as suites on all versions/platforms.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUITES = ['platform', 'approaches', 'packs'];

function collectTests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTests(full, out);
    else if (entry.isFile() && entry.name.endsWith('.test.cjs')) out.push(full);
  }
  return out;
}

const files = SUITES.flatMap((name) => collectTests(path.join(ROOT, 'tests', name)))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('No test files found under tests/{platform,approaches,packs}');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status == null ? 1 : result.status);
