/** Project kinds: NAMED = real system; WORKSPACE = approach panel (ws-*). */

const PROJECT_KIND_NAMED = 'NAMED';
const PROJECT_KIND_WORKSPACE = 'WORKSPACE';

function isWorkspaceCode(code) {
  return /^ws-/i.test(String(code || '').trim());
}

function normalizeProjectKind(value, code) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === PROJECT_KIND_WORKSPACE || isWorkspaceCode(code)) return PROJECT_KIND_WORKSPACE;
  return PROJECT_KIND_NAMED;
}

/** SQL fragment requiring named (organizational) projects. */
function namedProjectsSql(alias = 'p') {
  return `${alias}.kind = '${PROJECT_KIND_NAMED}'`;
}

module.exports = {
  PROJECT_KIND_NAMED,
  PROJECT_KIND_WORKSPACE,
  isWorkspaceCode,
  namedProjectsSql,
  normalizeProjectKind,
};
