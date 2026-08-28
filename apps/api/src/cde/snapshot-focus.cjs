const DEFAULT_WEB_FOCUS = /auth|community|announcement|\/App$|medu-community/i;
const DEFAULT_API_FOCUS = /auth|community|announcement|comment|post|feed|profile|medu-community/i;

function compileFocus(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  try { return new RegExp(raw, 'i'); } catch { return fallback; }
}

function webFocus() {
  return compileFocus('CDE_SNAPSHOT_WEB_FOCUS', DEFAULT_WEB_FOCUS);
}

function apiFocus() {
  return compileFocus('CDE_SNAPSHOT_API_FOCUS', DEFAULT_API_FOCUS);
}

function requiredMatch(requiredIds, packId, type) {
  if (!requiredIds || !requiredIds.size) return false;
  const id = String(packId || '');
  if (requiredIds.has(id)) return true;
  if (type === 'WEB_UI') {
    if (!id.startsWith('pages/') && requiredIds.has(`pages/component/${id}`)) return true;
    const stripped = id.match(/^pages\/component\/(.+)$/);
    if (stripped && requiredIds.has(stripped[1])) return true;
  }
  return false;
}

function shouldKeepRuntimePackage(type, packId, { savedIds, requiredIds, webKept = 0, apiKept = 0 } = {}) {
  const id = String(packId || '');
  if (!id) return { keep: false, reason: 'EMPTY_PACK_ID' };
  if (requiredMatch(requiredIds, id, type)) return { keep: true, focused: true, required: true };
  if (savedIds && savedIds.has(id)) return { keep: true, focused: true };
  const WEB_FOCUS = webFocus();
  const API_FOCUS = apiFocus();
  if (type === 'WEB_UI') {
    if (savedIds && savedIds.size) return { keep: false, reason: 'WEB_UI_NOT_SELECTED' };
    if (WEB_FOCUS.test(id)) return { keep: true, focused: true };
    if (webKept >= 2) return { keep: false, reason: 'WEB_UI_TRIMMED' };
    return { keep: true };
  }
  if (type === 'API_MODULE') {
    if (savedIds && savedIds.size && !API_FOCUS.test(id)) return { keep: false, reason: 'API_MODULE_NOT_SELECTED' };
    if (API_FOCUS.test(id)) return { keep: true, focused: true };
    if (apiKept >= 8) return { keep: false, reason: 'API_MODULE_TRIMMED' };
    return { keep: true };
  }
  return { keep: true };
}

function savedIdsFor(type, selections) {
  return new Set(
    (selections || [])
      .filter(row => row.repository_type === type)
      .map(row => String(row.pack_id || ''))
      .filter(Boolean),
  );
}

module.exports = {
  shouldKeepRuntimePackage,
  requiredMatch,
  savedIdsFor,
  webFocus,
  apiFocus,
  WEB_FOCUS: DEFAULT_WEB_FOCUS,
  API_FOCUS: DEFAULT_API_FOCUS,
};
