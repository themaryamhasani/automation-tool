const path = require('node:path');

class ZipError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function repoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function sourcesRoot() {
  const configured = process.env.SOURCE_WORK_ROOT;
  if (configured && path.isAbsolute(configured)) return configured;
  return path.resolve(repoRoot(), configured || path.join('runtime', 'sources'));
}

function projectZipRoot(projectId) {
  const root = path.resolve(sourcesRoot(), 'zip', String(projectId));
  if (!root.startsWith(sourcesRoot())) throw new ZipError('ZIP_UNSAFE_PATH', 'مسیر استخراج نامعتبر است.', 422);
  return root;
}

module.exports = { ZipError, repoRoot, sourcesRoot, projectZipRoot };
