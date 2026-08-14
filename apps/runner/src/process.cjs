const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const RUNNER_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT_CLI = require.resolve('@playwright/test/cli');

function sanitizeEnv(source) {
  const env = {};
  for (const [key, value] of Object.entries(source || process.env)) {
    if (value == null) continue;
    env[key] = String(value);
  }
  if (process.platform === 'win32') {
    if (!env.SYSTEMROOT && process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    if (!env.SystemRoot && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (!env.COMSPEC && process.env.ComSpec) env.COMSPEC = process.env.ComSpec;
    if (!env.PATH && process.env.Path) env.PATH = process.env.Path;
  }
  env.FORCE_COLOR = env.FORCE_COLOR || '0';
  const unsetCi = source && (source.AUTOMATION_UNSET_CI === '1' || source.CI === '' || source.CI === '0');
  if (unsetCi) {
    delete env.CI;
    delete env.AUTOMATION_UNSET_CI;
  } else if (!env.CI) {
    env.CI = '1';
  }
  return env;
}

function findOnPath(names) {
  const dirs = String(process.env.PATH || process.env.Path || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function npmCliJs() {
  const dir = path.dirname(process.execPath);
  return [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find(item => fs.existsSync(item)) || null;
}

function npxCliJs() {
  const dir = path.dirname(process.execPath);
  return [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].find(item => fs.existsSync(item)) || null;
}

function chromePath() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(item => fs.existsSync(item)) || null;
}

function localPlaywrightCli(cwd) {
  if (!cwd) return null;
  const cli = path.join(cwd, 'node_modules', '@playwright', 'test', 'cli.js');
  return fs.existsSync(cli) ? cli : null;
}

function resolveBin(bin) {
  const name = String(bin || '');
  if (!name || name === 'node' || name === 'node.exe') {
    return { command: process.execPath, prefix: [] };
  }
  if (name === 'npm' || name === 'npm.cmd' || name === 'npm.exe') {
    const cli = npmCliJs();
    if (cli) return { command: process.execPath, prefix: [cli] };
    const exe = findOnPath(process.platform === 'win32' ? ['npm.cmd', 'npm.exe'] : ['npm']);
    return { command: exe || 'npm', prefix: [], shell: process.platform === 'win32' };
  }
  if (name === 'npx' || name === 'npx.cmd' || name === 'npx.exe') {
    const cli = npxCliJs();
    if (cli) return { command: process.execPath, prefix: [cli] };
    const exe = findOnPath(process.platform === 'win32' ? ['npx.cmd', 'npx.exe'] : ['npx']);
    return { command: exe || 'npx', prefix: [], shell: process.platform === 'win32' };
  }
  if (name === 'k6' || name === 'k6.exe') {
    const exe = findOnPath(process.platform === 'win32' ? ['k6.exe', 'k6'] : ['k6']) || (process.platform === 'win32' ? 'k6.exe' : 'k6');
    return { command: exe, prefix: [] };
  }
  if (fs.existsSync(name)) return { command: name, prefix: [] };
  const found = findOnPath(process.platform === 'win32' ? [name, `${name}.exe`, `${name}.cmd`] : [name]);
  return { command: found || name, prefix: [], shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(found || name) };
}

function spawnLogged(command, args, options = {}, onChunk) {
  return new Promise((resolve, reject) => {
    const env = sanitizeEnv(options.env || process.env);
    const argv = (args || []).filter(item => item != null).map(item => String(item));
    const resolved = options.__resolved ? { command, prefix: [] } : resolveBin(command);
    const file = resolved.command;
    const spawnArgs = [...(resolved.prefix || []), ...argv];
    if (options.cwd && !fs.existsSync(options.cwd)) {
      reject(new Error(`پوشه اجرا پیدا نشد: ${options.cwd}`));
      return;
    }
    const tryOpts = hide => ({
      cwd: options.cwd || undefined,
      env,
      windowsHide: hide,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: Boolean(options.shell || resolved.shell),
    });
    const start = hide => {
      try {
        return spawn(file, spawnArgs, tryOpts(hide));
      } catch (error) {
        if (error && error.code === 'EINVAL' && hide) return start(false);
        throw error;
      }
    };
    let child;
    try {
      child = start(options.windowsHide !== false);
    } catch (error) {
      error.message = `${error.message} (${file} ${spawnArgs.join(' ')})`;
      reject(error);
      return;
    }
    let out = '';
    const append = chunk => {
      const text = chunk.toString('utf8');
      out += text;
      if (out.length > 2_000_000) out = `[log truncated]\n${out.slice(-1_900_000)}`;
      onChunk?.(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', error => {
      if (error.code === 'EINVAL' && !options.__einvalRetried) {
        spawnLogged(file, spawnArgs, { ...options, env, __einvalRetried: true, __resolved: true, windowsHide: false, shell: true }, onChunk)
          .then(resolve, reject);
        return;
      }
      error.message = `${error.message} (${file} ${spawnArgs.join(' ')})`;
      reject(error);
    });
    child.once('exit', code => resolve({ code: code ?? 1, out, child, command: file, args: spawnArgs }));
    if (options.signal) {
      const stop = () => {
        if (child.exitCode != null) return;
        if (process.platform === 'win32' && child.pid) spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${child.pid} /t /f`], { windowsHide: true });
        else child.kill('SIGTERM');
      };
      options.signal.addEventListener('abort', stop, { once: true });
    }
  });
}

async function runProcess(command, args, cwd, env, timeoutSeconds, shouldCancel, onChunk) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, Number(timeoutSeconds || 120)) * 1000);
  const poll = setInterval(async () => {
    if (await shouldCancel?.()) controller.abort();
  }, 1000);
  try {
    return await spawnLogged(command, args, { cwd, env, signal: controller.signal }, onChunk);
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}

function browserChannel(executable) {
  if (!executable) return process.env.PW_CHANNEL || '';
  const lower = String(executable).toLowerCase();
  if (lower.includes('msedge') || lower.includes('\\edge\\')) return 'msedge';
  if (lower.includes('chrome')) return 'chrome';
  return process.env.PW_CHANNEL || '';
}

function writePlaywrightConfig({ testDir, specFile, baseURL, headed, jsonFile, playwrightRequire }) {
  const chrome = chromePath();
  const channel = browserChannel(chrome);
  const req = playwrightRequire || '@playwright/test';
  return `const { defineConfig, devices } = require(${JSON.stringify(req)});
module.exports = defineConfig({
  testDir: ${JSON.stringify(testDir)},
  ${specFile ? `testMatch: ${JSON.stringify(specFile)},` : ''}
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: ${JSON.stringify(jsonFile)} }]],
  timeout: Number(process.env.E2E_TEST_TIMEOUT_MS || 60_000),
  use: {
    baseURL: ${JSON.stringify(baseURL || '')} || undefined,
    headless: ${headed ? 'false' : 'true'},
    locale: 'fa-IR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ${channel ? `channel: ${JSON.stringify(channel)},` : chrome ? `launchOptions: { executablePath: ${JSON.stringify(chrome)} },` : ''}
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;
}

function playwrightJob({ cwd, specPath, workspace, baseURL, headed }) {
  const e2eCwd = cwd && fs.existsSync(cwd) ? cwd : (specPath ? path.dirname(specPath) : process.cwd());
  const envExtra = {
    PW_CHANNEL: process.env.PW_CHANNEL || browserChannel(chromePath()) || 'chrome',
  };
  if (baseURL) envExtra.E2E_BASE_URL = baseURL;
  const dir = workspace && fs.existsSync(workspace) ? workspace : os.tmpdir();
  const jsonFile = path.join(dir, 'playwright-results.json');
  const configPath = path.join(dir, 'automation-playwright.config.cjs');
  let testDir = fs.existsSync(path.join(e2eCwd, 'specs')) ? path.join(e2eCwd, 'specs') : e2eCwd;
  let specFile = null;
  if (specPath && fs.existsSync(specPath)) {
    testDir = path.dirname(path.resolve(specPath));
    specFile = path.basename(specPath);
  }
  const localCli = localPlaywrightCli(e2eCwd);
  const cli = localCli || PLAYWRIGHT_CLI;
  const playwrightRequire = localCli
    ? path.join(e2eCwd, 'node_modules', '@playwright', 'test')
    : path.dirname(require.resolve('@playwright/test/package.json'));
  fs.writeFileSync(configPath, writePlaywrightConfig({
    testDir, specFile, baseURL, headed, jsonFile, playwrightRequire,
  }), 'utf8');
  return {
    command: process.execPath,
    args: [cli, 'test', '--config', configPath],
    cwd: localCli ? e2eCwd : dir,
    envExtra,
    jsonFile,
    configPath,
  };
}

async function ensureNpmInstall(cwd, shouldCancel) {
  if (!cwd || !fs.existsSync(path.join(cwd, 'package.json'))) return;
  if (fs.existsSync(path.join(cwd, 'node_modules'))) return;
  const npm = npmCliJs();
  if (!npm) throw new Error('npm پیدا نشد؛ برای اجرای تست‌های این ریپو باید وابستگی‌ها نصب شوند.');
  const result = await runProcess(process.execPath, [npm, 'install'], cwd, process.env, 900, shouldCancel);
  if (result.code) throw new Error(`npm install ریپو با کد ${result.code} شکست خورد.\n${result.out || ''}`.trim());
  if (!fs.existsSync(path.join(cwd, 'node_modules'))) throw new Error('npm install وابستگی‌های ریپو را نساخت.');
}

function findRepoPlaywrightConfig(root) {
  if (!root) return null;
  return ['playwright.config.ts', 'playwright.config.mjs', 'playwright.config.js', 'playwright.config.cjs']
    .map(name => path.join(root, name))
    .find(item => fs.existsSync(item)) || null;
}

function playwrightRepoJob({ sourceRoot, specPath, workspace }) {
  const config = findRepoPlaywrightConfig(sourceRoot);
  const jsonFile = path.join(workspace && fs.existsSync(workspace) ? workspace : os.tmpdir(), 'playwright-results.json');
  const cli = localPlaywrightCli(sourceRoot) || PLAYWRIGHT_CLI;
  const args = [cli, 'test', '--config', config];
  if (specPath && fs.existsSync(specPath)) {
    args.push(path.relative(sourceRoot, specPath).replace(/\\/g, '/'));
  }
  return {
    command: process.execPath,
    args,
    cwd: sourceRoot,
    jsonFile,
    configPath: config,
    envExtra: {
      PW_CHANNEL: process.env.PW_CHANNEL || browserChannel(chromePath()) || 'chrome',
    },
  };
}

function unitJob(command, cwd) {
  const list = Array.isArray(command) ? command : String(command || '').split(/\s+/).filter(Boolean);
  if (!list.length) throw new Error('دستور unit خالی است.');
  const [bin, ...rest] = list;
  if (bin === 'npx' && rest[0] === 'vitest') {
    const local = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
    if (fs.existsSync(local)) return { command: process.execPath, args: [local, ...rest.slice(1)], cwd };
  }
  const resolved = resolveBin(bin);
  return { command: resolved.command, args: [...resolved.prefix, ...rest], cwd, shell: resolved.shell };
}

module.exports = {
  sanitizeEnv,
  findOnPath,
  chromePath,
  resolveBin,
  spawnLogged,
  runProcess,
  playwrightJob,
  playwrightRepoJob,
  findRepoPlaywrightConfig,
  ensureNpmInstall,
  unitJob,
  npmCliJs,
  PLAYWRIGHT_CLI,
  RUNNER_ROOT,
};
