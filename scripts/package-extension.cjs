#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const extensionRoot = path.join(root, 'apps', 'extension');
const dist = path.join(extensionRoot, 'dist');
const outputDirectory = path.join(root, 'artifacts', 'extension');
const output = path.join(outputDirectory, 'extension.zip');
const fixedDate = new Date('1980-01-01T00:00:00.000Z');

function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => entry.isDirectory()
      ? files(path.join(directory, entry.name), path.posix.join(prefix, entry.name))
      : [path.posix.join(prefix, entry.name)]);
}

function validateManifest(manifest) {
  const pkg = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  const errors = [];
  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
  if (manifest.version !== pkg.version) errors.push('manifest version must match apps/extension/package.json');
  if (manifest.background?.service_worker !== 'background.js' || manifest.background?.type !== 'module') errors.push('module service worker is required');
  if (manifest.side_panel?.default_path !== 'sidepanel.html') errors.push('side panel entry is required');
  const matches = manifest.externally_connectable?.matches;
  if (!Array.isArray(matches) || matches.length !== 1 || !/^https?:\/\/[^*:/]+(?:\.[^*:/]+)*\/\*$|^http:\/\/(?:localhost|127\.0\.0\.1)\/\*$/.test(matches[0])) {
    errors.push('externally_connectable must contain one configured trusted web origin');
  }
  const hosts = manifest.host_permissions;
  if (!Array.isArray(hosts) || hosts.length !== 1 || hosts.some(value => /^https?:\/\/\*\//.test(value))) errors.push('host_permissions must contain only the configured API origin');
  if (process.env.EXTENSION_REQUIRE_PRODUCTION_ORIGINS === '1') {
    const configuredOrigins = [...(Array.isArray(matches) ? matches : []), ...(Array.isArray(hosts) ? hosts : [])];
    if (configuredOrigins.length !== 2 || configuredOrigins.some(value => !value.startsWith('https://') || /\/\/(?:localhost|127\.0\.0\.1)\//.test(value))) {
      errors.push('publishing requires exact non-local HTTPS web and API origins');
    }
  }
  for (const permission of ['debugger', 'sidePanel', 'storage', 'tabs']) if (!manifest.permissions?.includes(permission)) errors.push(`missing permission: ${permission}`);
  if (errors.length) throw new Error(`Extension manifest validation failed:\n- ${errors.join('\n- ')}`);
}

async function main() {
  const manifestPath = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Extension build is missing. Run npm run build:extension first.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const entries = files(dist);
  if (entries.some(file => file.endsWith('.map'))) throw new Error('Source maps must not be included in the production extension package.');
  for (const required of ['manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.js']) {
    if (!entries.includes(required)) throw new Error(`Extension package is missing ${required}.`);
  }
  const zip = new JSZip();
  for (const relative of entries) {
    zip.file(relative, fs.readFileSync(path.join(dist, ...relative.split('/'))), {
      date: fixedDate,
      createFolders: false,
      unixPermissions: 0o100644,
    });
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(output, bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log(JSON.stringify({ ok: true, artifact: path.relative(root, output).replace(/\\/g, '/'), files: entries.length, bytes: bytes.length, sha256: digest, version: manifest.version }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
