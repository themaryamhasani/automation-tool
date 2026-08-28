'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractImportSpecifiers,
  extractManifestDependencies,
  collectDependencySpecs,
  resolveDependency,
  packIdCandidates,
  isPackAlreadyPresent,
  missingDependencies,
  expandSnapshotDependencies,
  isSkippableSpecifier,
} = require('../../apps/api/src/cde/snapshot-deps.cjs');
const { shouldKeepRuntimePackage } = require('../../apps/api/src/cde/snapshot-focus.cjs');

test('skips npm, relative, and URL import specs', () => {
  assert.equal(isSkippableSpecifier('react'), true);
  assert.equal(isSkippableSpecifier('@mui/material'), true);
  assert.equal(isSkippableSpecifier('./local'), true);
  assert.equal(isSkippableSpecifier('https://cdn.example/x.js'), true);
  assert.equal(isSkippableSpecifier('parham/lib/packs/translate'), false);
  assert.equal(isSkippableSpecifier('ds/emis-medu/my-accounts/load'), false);
});

test('extracts CDE imports from source and ignores react', () => {
  const code = `
    import React from 'react';
    import DC from 'parham/lib/packs/data-context';
    import { Confirm } from "parsa/lib/components/common/Confirm";
    const x = require('tavan/components/GTable');
    export { default } from 'soha/packs/dictionary';
  `;
  const specs = extractImportSpecifiers(code);
  assert.deepEqual(specs.sort(), [
    'parham/lib/packs/data-context',
    'parsa/lib/components/common/Confirm',
    'soha/packs/dictionary',
    'tavan/components/GTable',
  ]);
});

test('reads package.json and provider.json dependency keys', () => {
  assert.deepEqual(
    extractManifestDependencies(JSON.stringify({
      dependencies: {
        'parham/lib/packs/translate': 'last',
        'ds/emis-medu/my-accounts/load': 'app',
        react: '18',
      },
    })).sort(),
    ['ds/emis-medu/my-accounts/load', 'parham/lib/packs/translate'],
  );
});

test('collectDependencySpecs merges imports and manifests from snapshot files', () => {
  const specs = collectDependencySpecs([
    {
      path: 'web-ui/packages/x/source/imports.js',
      code: "import { LoadingOval } from 'parsa/lib/components/common/LoadingOval';",
    },
    {
      path: 'web-ui/packages/x/source/package.json',
      code: JSON.stringify({ dependencies: { 'tavan/components/BForm': 'last', 'parham/lib/packs/translate': 'last' } }),
    },
    {
      path: 'web-ui/packages/x/source/provider.json',
      code: JSON.stringify({ dependencies: { 'ds/emis-medu/my-accounts/load': 'app' } }),
    },
  ]);
  assert.ok(specs.includes('parsa/lib/components/common/LoadingOval'));
  assert.ok(specs.includes('tavan/components/BForm'));
  assert.ok(specs.includes('parham/lib/packs/translate'));
  assert.ok(specs.includes('ds/emis-medu/my-accounts/load'));
});

test('resolveDependency maps web and api specs to foreign repos', () => {
  const web = resolveDependency('parham/lib/packs/translate', 'tavan');
  assert.equal(web.repositoryType, 'WEB_UI');
  assert.equal(web.repoName, 'parham/web-ui');
  assert.equal(web.external, true);
  assert.ok(web.candidates.includes('parham/lib/packs/translate'));
  assert.ok(web.candidates.includes('pages/component/parham/lib/packs/translate'));

  const api = resolveDependency('ds/emis-medu/my-accounts/load', 'tavan');
  assert.equal(api.repositoryType, 'API_MODULE');
  assert.equal(api.repoName, 'emis-medu/api-module');
  assert.equal(api.packId, 'ds/emis-medu/my-accounts/load');
  assert.equal(api.external, true);

  const local = resolveDependency('tavan/components/BForm', 'tavan');
  assert.equal(local.external, false);
  assert.equal(local.repoName, 'tavan/web-ui');
});

test('packIdCandidates aliases pages/component forms', () => {
  assert.deepEqual(
    packIdCandidates('tavan/components/BForm', 'WEB_UI').sort(),
    ['pages/component/tavan/components/BForm', 'tavan/components/BForm'].sort(),
  );
  assert.ok(packIdCandidates('pages/component/tavan/App', 'WEB_UI').includes('tavan/App'));
});

test('isPackAlreadyPresent matches aliased same-project packs', () => {
  const packages = [{ repositoryType: 'WEB_UI', repoName: 'tavan/web-ui', packId: 'pages/component/tavan/components/BForm' }];
  const resolved = resolveDependency('tavan/components/BForm', 'tavan');
  assert.equal(isPackAlreadyPresent(packages, resolved), true);
  assert.equal(isPackAlreadyPresent(packages, resolveDependency('parham/lib/packs/translate', 'tavan')), false);
});

test('missingDependencies returns only packs not already in snapshot', () => {
  const files = [
    {
      path: 'web-ui/packages/app/source/package.json',
      code: JSON.stringify({
        dependencies: {
          'tavan/components/BForm': 'last',
          'parham/lib/packs/translate': 'last',
          'ds/emis-medu/my-accounts/load': 'app',
        },
      }),
    },
  ];
  const packages = [
    { repositoryType: 'WEB_UI', repoName: 'tavan/web-ui', packId: 'pages/component/tavan/components/BForm' },
  ];
  const missing = missingDependencies(files, packages, 'tavan');
  assert.equal(missing.some(item => item.packId === 'tavan/components/BForm'), false);
  assert.ok(missing.some(item => item.packId === 'parham/lib/packs/translate'));
  assert.ok(missing.some(item => item.packId === 'ds/emis-medu/my-accounts/load'));
});

test('expandSnapshotDependencies fetches external import into snapshot recursively', async () => {
  const files = [
    {
      path: 'web-ui/packages/app/source/imports.js',
      code: "import DC from 'parham/lib/packs/data-context';\n",
      repositoryType: 'WEB_UI',
      packId: 'pages/component/tavan/App',
    },
  ];
  const packages = [
    { repositoryType: 'WEB_UI', repoName: 'tavan/web-ui', packId: 'pages/component/tavan/App' },
  ];
  const warnings = [];
  const fetched = [];

  const result = await expandSnapshotDependencies({
    files,
    packages,
    paths: new Set(),
    warnings,
    projectKey: 'tavan',
    maxDepth: 2,
    maxPackages: 10,
    addPackageFiles: (entry) => {
      packages.push({
        repositoryType: entry.repositoryType,
        repoName: entry.repoName,
        packId: entry.packId,
        dependency: true,
        external: entry.external,
      });
      for (const file of entry.files) {
        files.push({
          path: `web-ui/packages/${encodeURIComponent(entry.packId)}/source/${file.path}`,
          code: file.code,
          repositoryType: entry.repositoryType,
          packId: entry.packId,
        });
      }
    },
    fetchResolved: async (resolved) => {
      fetched.push(resolved.spec);
      if (resolved.spec === 'parham/lib/packs/data-context') {
        return {
          repositoryType: 'WEB_UI',
          repoName: 'parham/web-ui',
          packId: 'parham/lib/packs/data-context',
          selector: { kind: 'PUBLIC' },
          versionId: 'v1',
          files: [
            {
              path: 'package.json',
              code: JSON.stringify({ dependencies: { 'parsa/lib/components/common/Confirm': 'last' } }),
            },
            { path: 'index.js', code: "export default {};\n" },
          ],
        };
      }
      if (resolved.spec === 'parsa/lib/components/common/Confirm') {
        return {
          repositoryType: 'WEB_UI',
          repoName: 'parsa/web-ui',
          packId: 'parsa/lib/components/common/Confirm',
          selector: { kind: 'PUBLIC' },
          versionId: 'v2',
          files: [{ path: 'index.js', code: "export const Confirm = () => null;\n" }],
        };
      }
      return null;
    },
  });

  assert.equal(result.fetched, 2);
  assert.ok(fetched.includes('parham/lib/packs/data-context'));
  assert.ok(fetched.includes('parsa/lib/components/common/Confirm'));
  assert.ok(packages.some(item => item.packId === 'parham/lib/packs/data-context' && item.external && item.dependency));
  assert.ok(packages.some(item => item.packId === 'parsa/lib/components/common/Confirm' && item.external));
  assert.equal(warnings.length, 0);
});

test('requiredIds always keep dependency packs that focus would trim', () => {
  const requiredIds = new Set(['pages/component/tavan/components/BForm', 'tavan/components/BForm']);
  assert.equal(
    shouldKeepRuntimePackage('WEB_UI', 'pages/component/tavan/components/BForm', { requiredIds, webKept: 9 }).keep,
    true,
  );
  assert.equal(
    shouldKeepRuntimePackage('WEB_UI', 'pages/component/tavan/components/BForm', { webKept: 9 }).keep,
    false,
  );
});
