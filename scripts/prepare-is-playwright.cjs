#!/usr/bin/env node
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { listPacks } = require('../apps/api/src/approaches/is/packs.cjs');
const { packPaths } = require('../apps/api/src/approaches/is/service.cjs');
const { prepareIsPlaywrightRuntime } = require('../apps/runner/src/process.cjs');

function main() {
  const e2eRoots = [];
  let docRoot;
  for (const pack of listPacks()) {
    try {
      const paths = packPaths(pack.id);
      docRoot = paths.docRoot;
      e2eRoots.push(paths.e2eCwd);
    } catch {
      /* pack missing */
    }
  }
  const prepared = prepareIsPlaywrightRuntime({ docRoot, e2eRoots });
  console.log(JSON.stringify({
    event: 'is-playwright-prepared',
    docRoot: docRoot || null,
    e2eRoots: e2eRoots.length,
    sharedPackage: prepared.sharedPackage || null,
    restoredStashes: prepared.restored.length,
  }));
}

main();
