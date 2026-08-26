const fs = require('node:fs');
const path = require('node:path');
const { getPack } = require('./packs.cjs');

class ApproachError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isRoot() {
  return path.resolve(process.env.IS_ROOT || 'D:\\AllApp\\IS\\integrated-systems');
}

function testRoot() {
  return path.resolve(isRoot(), process.env.IS_TEST_REL || 'test');
}

function docRoot() {
  return path.resolve(isRoot(), process.env.IS_DOC_REL || 'test/doc');
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ApproachError('IS_UNSAFE_PATH', 'مسیر خارج از ریشه IS است.', 422);
  }
  return resolved;
}

function ensureIsLayout() {
  const root = isRoot();
  const tests = testRoot();
  const docs = docRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new ApproachError('IS_ROOT_MISSING', `ریشه IS پیدا نشد: ${root}`, 409);
  }
  if (!fs.existsSync(tests) || !fs.statSync(tests).isDirectory()) {
    throw new ApproachError('IS_TEST_MISSING', `پوشه test پیدا نشد: ${tests}`, 409);
  }
  if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) {
    throw new ApproachError('IS_DOC_MISSING', `پوشه test/doc پیدا نشد: ${docs}`, 409);
  }
  return { root, tests, docs };
}

function packPaths(packId) {
  const pack = getPack(packId);
  if (!pack) throw new ApproachError('IS_PACK_NOT_FOUND', 'بسته QA پیدا نشد.', 404);
  const { root, docs } = ensureIsLayout();
  const productRoot = assertInside(docs, path.join(docs, pack.docPath));
  if (!fs.existsSync(productRoot)) throw new ApproachError('IS_PACK_NOT_FOUND', `پوشه بسته ${pack.id} روی دیسک نیست.`, 404);
  return {
    pack,
    repoRoot: root,
    docRoot: docs,
    productRoot,
    scriptsRoot: path.join(productRoot, 'scripts'),
    reportsRoot: path.join(productRoot, 'reports'),
    dangerCwd: path.join(productRoot, pack.danger.cwd),
    k6Cwd: path.join(productRoot, pack.k6.cwd),
    e2eCwd: path.join(productRoot, pack.e2e.cwd),
    unitCwd: path.join(root, pack.unit.cwdFromRepo),
    boardScript: path.join(docs, 'build-report-boards.mjs'),
  };
}

module.exports = {
  ApproachError,
  isRoot,
  testRoot,
  docRoot,
  assertInside,
  ensureIsLayout,
  packPaths,
};
