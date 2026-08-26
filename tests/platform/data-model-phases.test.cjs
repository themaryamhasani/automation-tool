/**
 * Contract: data-model phases 1–7 stay wired (migrations + helpers + tests layout).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

const PHASES = [
  {
    id: 1,
    name: 'domain schemas',
    migration: 'database/011_domain_schemas.sql',
    helpers: ['shared/db/search-path.cjs'],
    mustMatch: [/CREATE SCHEMA IF NOT EXISTS catalog/, /SET SCHEMA exec/],
  },
  {
    id: 2,
    name: 'run split',
    migration: 'database/012_run_split.sql',
    helpers: ['shared/db/run-store.cjs'],
    mustMatch: [/exec\.run_requests/, /exec\.run_logs/],
  },
  {
    id: 3,
    name: 'project targets',
    migration: 'database/013_project_targets.sql',
    helpers: ['shared/runtime/app-targets.cjs', 'shared/runtime/targets-registry.json', 'scripts/sync-project-targets.cjs'],
    mustMatch: [/catalog\.project_targets/],
  },
  {
    id: 4,
    name: 'binding normalize',
    migration: 'database/014_binding_normalize.sql',
    helpers: ['shared/db/bindings.cjs'],
    mustMatch: [/source\.binding_git/, /source\.binding_zip/],
  },
  {
    id: 5,
    name: 'runtime session scope',
    migration: 'database/015_runtime_session_scope.sql',
    helpers: ['shared/runtime/session-store.cjs'],
    mustMatch: [/PRIMARY KEY \(user_id, environment_id, pack_key\)/],
  },
  {
    id: 6,
    name: 'project kind workspace',
    migration: 'database/016_project_kind.sql',
    helpers: ['shared/db/project-kind.cjs'],
    mustMatch: [/WORKSPACE/, /kind varchar\(20\)/],
  },
  {
    id: 7,
    name: 'thin pack generator + pack_id widen',
    migration: 'database/017_pack_id_widen.sql',
    helpers: [
      'scripts/lib/cde-pack-scaffold.cjs',
      'scripts/seed-cde-pack.cjs',
      'scripts/pack-defs/tavan.cjs',
      'scripts/pack-defs/medu-camp.cjs',
    ],
    mustMatch: [/pack_id TYPE varchar\(120\)/],
  },
];

test('all seven data-model phases have migrations and helpers', () => {
  for (const phase of PHASES) {
    const migrationPath = path.join(ROOT, phase.migration);
    assert.equal(fs.existsSync(migrationPath), true, `phase ${phase.id} missing ${phase.migration}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    for (const re of phase.mustMatch) {
      assert.match(sql, re, `phase ${phase.id} (${phase.name})`);
    }
    for (const helper of phase.helpers) {
      assert.equal(fs.existsSync(path.join(ROOT, helper)), true, `phase ${phase.id} missing ${helper}`);
    }
  }
});

test('APP_TARGETS hard-code is gone and tests follow platform|approaches|packs', () => {
  const appTargets = fs.readFileSync(path.join(ROOT, 'shared/runtime/app-targets.cjs'), 'utf8');
  assert.doesNotMatch(appTargets, /const APP_TARGETS\s*=\s*\{/);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/platform')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/approaches')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/packs/pack-contract.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/packs/pack-scaffold.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/approaches/bindings.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/approaches/runtime-session-scope.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/platform/project-kind.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/platform/run-split.test.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'tests/approaches/project-targets.test.cjs')), true);
});

test('thin seeds stay wrappers over the generator', () => {
  for (const file of ['scripts/seed-tavan-pack.cjs', 'scripts/seed-medu-camp-pack.cjs']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(text, /seed-cde-pack\.cjs/);
    assert.ok(text.length < 500, `${file} should be a thin wrapper`);
  }
});
