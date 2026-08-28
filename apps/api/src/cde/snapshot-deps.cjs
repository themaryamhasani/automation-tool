'use strict';

const { normalizeSourcePath } = require('./data-service-compiler.cjs');

const MAX_DEP_DEPTH = Math.max(1, Math.min(8, Number(process.env.CDE_SNAPSHOT_DEP_DEPTH || 3)));
const MAX_DEP_PACKAGES = Math.max(1, Math.min(200, Number(process.env.CDE_SNAPSHOT_DEP_MAX_PACKAGES || 80)));

const NPM_SCOPED = /^@[^/]+\//;
const RELATIVE = /^\./;
const URL_LIKE = /^(?:https?:|data:|blob:)/i;
const BARE_NPM = /^(?:react|react-dom|react-router(?:-dom)?|lodash(?:-es)?|axios|moment|dayjs|jquery|vue|angular|rxjs|redux|mobx|zustand|immer|uuid|classnames|clsx|prop-types|history|formik|yup|zod|chart\.js|d3|three|socket\.io-client)$/i;

const IMPORT_FROM = /(?:^|[^\w$.])(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
const REQUIRE_CALL = /(?:^|[^\w$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

function safeNormalize(value) {
  try {
    return normalizeSourcePath(String(value || '').replace(/\\/g, '/').replace(/^\.\//, ''));
  } catch {
    return '';
  }
}

function isSkippableSpecifier(spec) {
  const id = String(spec || '').trim();
  if (!id) return true;
  if (RELATIVE.test(id) || URL_LIKE.test(id)) return true;
  if (NPM_SCOPED.test(id)) return true;
  if (!id.includes('/')) return true;
  if (BARE_NPM.test(id.split('/')[0])) return true;
  return false;
}

function extractImportSpecifiers(code) {
  const text = String(code || '');
  const found = new Set();
  for (const pattern of [IMPORT_FROM, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const spec = String(match[1] || '').trim();
      if (!isSkippableSpecifier(spec)) found.add(spec);
    }
  }
  return [...found];
}

function extractManifestDependencies(code) {
  try {
    const parsed = JSON.parse(String(code || '{}'));
    const deps = parsed && typeof parsed === 'object' ? parsed.dependencies : null;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return [];
    return Object.keys(deps)
      .map(key => String(key || '').trim())
      .filter(key => key && !isSkippableSpecifier(key));
  } catch {
    return [];
  }
}

function collectDependencySpecs(files) {
  const found = new Set();
  for (const file of files || []) {
    const path = safeNormalize(file.path || file.name || '');
    const base = path.split('/').pop() || '';
    const code = String(file.code || '');
    if (base === 'package.json' || base === 'provider.json') {
      for (const dep of extractManifestDependencies(code)) found.add(dep);
      continue;
    }
    if (!/\.(?:js|jsx|mjs|cjs|ts|tsx)$/i.test(base)) continue;
    for (const dep of extractImportSpecifiers(code)) found.add(dep);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function packIdCandidates(packId, repositoryType = 'WEB_UI') {
  const id = safeNormalize(packId);
  if (!id) return [];
  const out = new Set([id]);
  if (repositoryType === 'WEB_UI' || repositoryType === 'DATA_SERVICE') {
    if (!id.startsWith('pages/')) out.add(`pages/component/${id}`);
    const stripped = id.match(/^pages\/component\/(.+)$/);
    if (stripped) out.add(stripped[1]);
  }
  return [...out];
}

function resolveDependency(spec, projectKey) {
  const id = safeNormalize(spec);
  if (!id || isSkippableSpecifier(id)) return null;

  if (/^(?:ds|fr)\//.test(id)) {
    const parts = id.split('/');
    const ownerProject = parts[1] || '';
    if (!ownerProject) return null;
    return {
      spec: id,
      repositoryType: 'API_MODULE',
      packId: id,
      ownerProject,
      repoName: `${ownerProject}/api-module`,
      external: ownerProject !== String(projectKey || ''),
      candidates: [id],
    };
  }

  const ownerProject = id.split('/')[0];
  if (!ownerProject || ownerProject === 'pages' || ownerProject === 'node_modules') return null;
  return {
    spec: id,
    repositoryType: 'WEB_UI',
    packId: id,
    ownerProject,
    repoName: `${ownerProject}/web-ui`,
    external: ownerProject !== String(projectKey || ''),
    candidates: packIdCandidates(id, 'WEB_UI'),
  };
}

function packagePresenceKey(repositoryType, repoName, packId) {
  return `${repositoryType}::${repoName || ''}::${safeNormalize(packId)}`;
}

function knownPackageKeys(packages) {
  const keys = new Set();
  for (const item of packages || []) {
    const type = item.repositoryType;
    if (type !== 'WEB_UI' && type !== 'API_MODULE' && type !== 'DATA_SERVICE' && type !== 'MESSAGE_CONSUMER') continue;
    for (const candidate of packIdCandidates(item.packId, type)) {
      keys.add(packagePresenceKey(type, item.repoName, candidate));
      keys.add(packagePresenceKey(type, '', candidate));
    }
  }
  return keys;
}

function isPackAlreadyPresent(packages, resolved) {
  if (!resolved) return true;
  const keys = knownPackageKeys(packages);
  for (const candidate of resolved.candidates || packIdCandidates(resolved.packId, resolved.repositoryType)) {
    if (keys.has(packagePresenceKey(resolved.repositoryType, resolved.repoName, candidate))) return true;
    if (keys.has(packagePresenceKey(resolved.repositoryType, '', candidate))) return true;
  }
  return false;
}

function missingDependencies(files, packages, projectKey) {
  const missing = [];
  const seen = new Set();
  for (const spec of collectDependencySpecs(files)) {
    const resolved = resolveDependency(spec, projectKey);
    if (!resolved) continue;
    if (isPackAlreadyPresent(packages, resolved)) continue;
    const key = packagePresenceKey(resolved.repositoryType, resolved.repoName, resolved.packId);
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(resolved);
  }
  return missing;
}

/**
 * Expand snapshot with transitive CDE package dependencies.
 * `fetchResolved(resolved)` must return
 * `{ packId, repositoryType, repoName, selector, versionId, files:[{path,code}] }` or null.
 */
async function expandSnapshotDependencies(ctx) {
  const {
    files,
    packages,
    paths,
    warnings,
    projectKey,
    addPackageFiles,
    fetchResolved,
    reportProgress,
    maxDepth = MAX_DEP_DEPTH,
    maxPackages = MAX_DEP_PACKAGES,
  } = ctx;

  let depth = 0;
  let fetched = 0;
  const requiredIds = new Set();

  while (depth < maxDepth && fetched < maxPackages) {
    const missing = missingDependencies(files, packages, projectKey);
    if (!missing.length) break;

    let progressThisRound = 0;
    for (const resolved of missing) {
      if (fetched >= maxPackages) break;
      let loaded = null;
      try {
        loaded = await fetchResolved(resolved);
      } catch (error) {
        warnings.push({
          repositoryType: resolved.repositoryType,
          repoName: resolved.repoName,
          packId: resolved.packId,
          code: error.code || 'CDE_DEPENDENCY_FETCH_FAILED',
          message: error.message || `واکشی وابستگی ${resolved.packId} ناموفق بود.`,
          dependency: true,
          external: resolved.external,
        });
        continue;
      }
      if (!loaded) {
        warnings.push({
          repositoryType: resolved.repositoryType,
          repoName: resolved.repoName,
          packId: resolved.packId,
          code: 'CDE_DEPENDENCY_NOT_FOUND',
          message: `وابستگی ${resolved.spec} در ${resolved.repoName} پیدا نشد.`,
          dependency: true,
          external: resolved.external,
        });
        continue;
      }
      if (isPackAlreadyPresent(packages, { ...resolved, packId: loaded.packId, candidates: packIdCandidates(loaded.packId, loaded.repositoryType) })) {
        continue;
      }
      addPackageFiles({
        repositoryType: loaded.repositoryType || resolved.repositoryType,
        repoName: loaded.repoName || resolved.repoName,
        packId: loaded.packId,
        selector: loaded.selector,
        versionId: loaded.versionId,
        files: loaded.files || [],
        dependency: true,
        external: resolved.external,
        requestedSpec: resolved.spec,
      });
      requiredIds.add(loaded.packId);
      for (const candidate of packIdCandidates(loaded.packId, loaded.repositoryType || resolved.repositoryType)) {
        requiredIds.add(candidate);
      }
      fetched += 1;
      progressThisRound += 1;
      if (typeof reportProgress === 'function' && (progressThisRound === 1 || progressThisRound % 4 === 0)) {
        await reportProgress({
          phase: 'dependencies',
          repositoryType: loaded.repositoryType || resolved.repositoryType,
          packId: loaded.packId,
          packages: packages.length,
          files: files.length,
          message: `دریافت وابستگی CDE: ${fetched} پکیج وابسته (${resolved.spec} → ${loaded.packId})`,
        });
      }
    }
    if (!progressThisRound) break;
    depth += 1;
  }

  return { fetched, depth, requiredIds };
}

module.exports = {
  MAX_DEP_DEPTH,
  MAX_DEP_PACKAGES,
  extractImportSpecifiers,
  extractManifestDependencies,
  collectDependencySpecs,
  packIdCandidates,
  resolveDependency,
  isPackAlreadyPresent,
  missingDependencies,
  expandSnapshotDependencies,
  knownPackageKeys,
  isSkippableSpecifier,
};
