#!/usr/bin/env node
/**
 * Seed one or more CDE packs from thin defs + shared scaffold + overlays.
 * Usage:
 *   node scripts/seed-cde-pack.cjs tavan
 *   node scripts/seed-cde-pack.cjs medu-camp
 *   node scripts/seed-cde-pack.cjs --all
 */
const path = require('node:path');
const { scaffoldCdePack } = require('./lib/cde-pack-scaffold.cjs');

const DEFS = {
  tavan: () => require('./pack-defs/tavan.cjs'),
  'medu-camp': () => require('./pack-defs/medu-camp.cjs'),
};

function resolveKeys(argv) {
  if (argv.includes('--all') || argv.length === 0) return Object.keys(DEFS);
  return argv.filter((arg) => !arg.startsWith('-'));
}

function main(argv = process.argv.slice(2)) {
  const force = argv.includes('--force');
  const keys = resolveKeys(argv.filter((arg) => arg !== '--force'));
  if (!keys.length) {
    console.error('Usage: node scripts/seed-cde-pack.cjs <key|--all> [--force]');
    process.exit(2);
  }
  const results = [];
  for (const key of keys) {
    const load = DEFS[key];
    if (!load) {
      console.error(`Unknown pack def: ${key}. Known: ${Object.keys(DEFS).join(', ')}`);
      process.exit(2);
    }
    const def = {
      ...load(),
      overwriteTooling: force,
      overwriteFiles: force,
      overwritePackJson: true,
    };
    const result = scaffoldCdePack(def);
    results.push(result);
    console.log(`seeded ${result.approach.toLowerCase()}/${result.key} → ${path.relative(process.cwd(), result.root)} (overlay files: ${result.overlayFiles}${force ? ', force' : ''})`);
  }
  return results;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { main, DEFS };
