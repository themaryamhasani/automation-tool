const fs = require('node:fs');
const path = require('node:path');
const { vaultEnabled } = require('../../../../shared/secrets-resolve.cjs');
const { backend: storageBackend, isS3Ready, s3Config } = require('../../../../shared/object-storage.cjs');
const { oidcEnabled, oidcConfig } = require('../auth/oidc.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function loadOpenApi() {
  const file = path.join(ROOT, 'docs', 'openapi.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadRunbook() {
  const file = path.join(ROOT, 'docs', 'runbook-production.md');
  return fs.readFileSync(file, 'utf8');
}

function registerPlatformDocRoutes(app) {
  app.get('/api/openapi.json', (_req, res) => {
    res.json(loadOpenApi());
  });

  app.get('/api/docs/runbook', (_req, res) => {
    res.type('text/markdown; charset=utf-8').send(loadRunbook());
  });

  app.get('/api/platform/maturity', (_req, res) => {
    res.json({
      phase: 4,
      features: {
        totp2fa: true,
        oidcSso: oidcEnabled(),
        oidcIssuer: oidcEnabled() ? oidcConfig().issuer : null,
        objectStorage: storageBackend(),
        objectStorageReady: storageBackend() === 'disk' || isS3Ready(),
        s3Bucket: storageBackend() === 's3' ? (s3Config().bucket || null) : null,
        vault: vaultEnabled(),
        flakyAnalytics: true,
        runCompare: true,
        openApi: true,
        productionRunbook: true,
        scmStatusChecks: true,
        qualityGates: true,
        opsDashboard: true,
        runnerFleet: true,
      },
    });
  });
}

module.exports = { registerPlatformDocRoutes, loadOpenApi, loadRunbook };
