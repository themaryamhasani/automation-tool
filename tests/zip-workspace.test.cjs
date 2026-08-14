const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');

const PROJECT_ID = 'zip-workspace-demo';

async function withZipRoot(fn) {
  const previous = process.env.SOURCE_WORK_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-ws-'));
  process.env.SOURCE_WORK_ROOT = root;
  delete require.cache[require.resolve('../apps/api/src/approaches/zip/service.cjs')];
  const zipService = require('../apps/api/src/approaches/zip/service.cjs');
  try {
    await fn(zipService, root);
  } finally {
    if (previous == null) delete process.env.SOURCE_WORK_ROOT;
    else process.env.SOURCE_WORK_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function sampleZip() {
  const archive = new JSZip();
  archive.file('readme.md', '# sample\n');
  archive.folder('src').file('app.js', 'console.log(1);\n');
  return archive.generateAsync({ type: 'nodebuffer' });
}

test('ZIP workspace can create save mkdir and delete files and folders', async () => {
  await withZipRoot(async zipService => {
    await zipService.extractZipBuffer(PROJECT_ID, await sampleZip(), 'sample.zip');
    const tree = await zipService.listExtractedDir(PROJECT_ID, '');
    assert.ok(tree.entries.some(entry => entry.name === 'readme.md' && entry.type === 'file'));
    assert.ok(tree.entries.some(entry => entry.name === 'src' && entry.type === 'dir'));
    const src = await zipService.listExtractedDir(PROJECT_ID, 'src');
    assert.equal(src.entries.length, 1);
    assert.equal(src.entries[0].name, 'app.js');

    const created = await zipService.writeExtractedFile(PROJECT_ID, 'scripts/e2e/login.spec.ts', 'export {};\n', { create: true });
    assert.equal(created.created, true);
    const saved = await zipService.writeExtractedFile(PROJECT_ID, created.path, 'import { test } from "@playwright/test";\n');
    assert.equal(saved.created, false);
    assert.match(saved.code, /playwright/);

    const folder = await zipService.mkdirExtracted(PROJECT_ID, 'scripts/vitest');
    assert.equal(folder.path, 'scripts/vitest');
    await zipService.writeExtractedFile(PROJECT_ID, 'scripts/vitest/runtime.test.cjs', 'test("ok", () => {});\n', { create: true });

    const removedFile = await zipService.removeExtracted(PROJECT_ID, 'src/app.js');
    assert.equal(removedFile.deleted, true);
    assert.equal(removedFile.type, 'file');
    const removedDir = await zipService.removeExtracted(PROJECT_ID, 'scripts');
    assert.equal(removedDir.type, 'dir');
    const after = await zipService.listExtractedDir(PROJECT_ID, '');
    assert.equal(after.entries.some(entry => entry.name === 'scripts'), false);
    assert.equal(after.entries.some(entry => entry.name === 'src'), true);
  });
});

test('ZIP write and delete reject traversal and extract root', async () => {
  await withZipRoot(async zipService => {
    await zipService.extractZipBuffer(PROJECT_ID, await sampleZip(), 'sample.zip');
    await assert.rejects(
      () => zipService.writeExtractedFile(PROJECT_ID, '../outside.md', 'x', { create: true }),
      error => error.code === 'ZIP_UNSAFE_PATH' && error.status === 422,
    );
    await assert.rejects(
      () => zipService.mkdirExtracted(PROJECT_ID, 'src/../../outside'),
      error => error.code === 'ZIP_UNSAFE_PATH',
    );
    await assert.rejects(
      () => zipService.removeExtracted(PROJECT_ID, '..'),
      error => error.code === 'ZIP_UNSAFE_PATH',
    );
    await assert.rejects(
      () => zipService.removeExtracted(PROJECT_ID, ''),
      error => error.code === 'ZIP_UNSAFE_PATH' || error.code === 'ZIP_ROOT_PROTECTED',
    );
    await assert.rejects(
      () => zipService.listExtractedDir('missing-project', ''),
      error => error.code === 'ZIP_REQUIRED' && error.status === 409,
    );
  });
});
