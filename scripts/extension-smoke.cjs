#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const extensionPath = path.join(root, 'apps', 'extension', 'dist');

function cachedChromiumExecutable() {
  const expected = chromium.executablePath();
  if (fs.existsSync(expected)) return expected;
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!fs.existsSync(cacheRoot)) return undefined;
  const candidates = fs.readdirSync(cacheRoot)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  const relativeExecutables = process.platform === 'win32'
    ? [path.join('chrome-win64', 'chrome.exe'), path.join('chrome-win', 'chrome.exe')]
    : process.platform === 'darwin'
      ? [path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]
      : [path.join('chrome-linux', 'chrome')];
  for (const directory of candidates) {
    for (const relative of relativeExecutables) {
      const executable = path.join(cacheRoot, directory, relative);
      if (fs.existsSync(executable)) return executable;
    }
  }
  return undefined;
}

async function main() {
  if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('Build the extension first: npm run build:extension');
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-tool-extension-smoke-'));
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const next = _req.url === '/next';
    res.end(`<!doctype html><title>Recorder smoke target</title>
      ${next ? `<label>Email <input data-testid="email"></label>
      <button data-testid="record-me" onclick="document.querySelector('[data-testid=count]').textContent++">Record me</button>
      <output data-testid="count">0</output>` : '<a data-testid="next" href="/next">Continue</a>'}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Smoke server did not start.');

  let context;
  try {
    const executablePath = cachedChromiumExecutable();
    if (!executablePath) throw new Error('No Playwright Chromium found. Run: npx playwright install chromium');
    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    worker.on('console', message => console.log(`[extension:${message.type()}] ${message.text()}`));
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${address.port}`);
    await target.bringToFront();

    const recording = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'START_RECORDING' }));
    if (!recording?.ok || recording.state?.mode !== 'recording' || recording.state?.attachedTabId == null) throw new Error(`Automatic connect/record failed: ${recording?.error?.message || 'unknown error'}`);
    await target.getByTestId('next').click();
    await target.getByTestId('email').fill('qa@example.test');
    await target.getByTestId('record-me').click();
    await panel.waitForFunction(() => {
      const source = document.querySelector('.recorder-source-probe')?.value || '';
      return source.includes("@playwright/test") && source.includes('record-me') && source.includes('email');
    }, undefined, { timeout: 10_000 });
    const stopped = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }));
    if (!stopped?.ok) throw new Error(`Stop recording failed: ${stopped?.error?.message || 'unknown error'}`);
    const source = await panel.locator('.recorder-source-probe').inputValue();

    await target.bringToFront();
    const inspecting = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'START_INSPECTING' }));
    if (!inspecting?.ok || inspecting.state?.mode !== 'inspecting') throw new Error(`Inspect failed: ${inspecting?.error?.message || 'unknown error'}`);
    await target.getByTestId('record-me').click();
    await panel.locator('.assertion-builder code').waitFor({ state: 'visible', timeout: 10_000 });
    const locator = await panel.locator('.assertion-builder code').textContent();
    if (!locator?.includes('page.')) throw new Error(`Inspector returned an invalid locator: ${locator || 'empty'}`);
    const stoppedInspecting = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'STOP_INSPECTING' }));
    if (!stoppedInspecting?.ok) throw new Error(`Stop inspecting failed: ${stoppedInspecting?.error?.message || 'unknown error'}`);

    await target.goto(`http://127.0.0.1:${address.port}`);
    await target.bringToFront();
    const replayed = await panel.evaluate(testSource => chrome.runtime.sendMessage({ type: 'REPLAY', source: testSource, trace: true }), source);
    if (!replayed?.ok || replayed.state?.mode !== 'attached') {
      throw new Error(`Replay failed: ${replayed?.error?.message || 'unknown error'}\nRecorded source:\n${source}`);
    }
    const trace = await panel.evaluate(async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const downloads = await chrome.downloads.search({});
        const complete = downloads.find(item => item.state === 'complete' && (item.fileSize || 0) > 0);
        if (complete) return { id: complete.id, fileSize: complete.fileSize };
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const downloads = await chrome.downloads.search({});
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return { error: true, contexts: contexts.map(context => context.documentUrl), downloads: downloads.map(item => ({ filename: item.filename, state: item.state, fileSize: item.fileSize, error: item.error })) };
    });
    if (!trace || 'error' in trace) throw new Error(`Replay tracing did not produce a non-empty downloaded ZIP: ${JSON.stringify(trace)}`);

    const detached = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'DETACH' }));
    if (!detached?.ok || detached.state?.mode !== 'disconnected') {
      throw new Error(`Detach did not clean the session: ${JSON.stringify(detached)}`);
    }

    await panel.bringToFront();
    const restricted = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'ATTACH' }));
    if (restricted?.ok || restricted?.error?.code !== 'UNSUPPORTED_PAGE') throw new Error('Restricted extension page was not rejected.');
    console.log(JSON.stringify({
      ok: true,
      browserVersion: context.browser()?.version() || 'unknown',
      extensionId,
      serviceWorker: worker.url(),
      automaticAttach: true,
      record: true,
      inspect: true,
      replay: true,
      trace: true,
      traceBytes: trace.fileSize,
      detach: true,
      restrictedPage: true,
    }));
  } finally {
    await context?.close().catch(() => undefined);
    await new Promise(resolve => server.close(resolve));
    const temporaryRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(`${temporaryRoot}${path.sep}`) && path.basename(resolvedProfile).startsWith('automation-tool-extension-smoke-')) {
      fs.rmSync(resolvedProfile, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
