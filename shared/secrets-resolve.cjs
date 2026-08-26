const VAULT_TIMEOUT_MS = Math.max(3000, Number(process.env.VAULT_TIMEOUT_MS || 10000));

function vaultEnabled() {
  return Boolean(process.env.VAULT_ADDR && process.env.VAULT_TOKEN);
}

function parseVaultRef(sourceName) {
  const raw = String(sourceName || '');
  if (!raw.toLowerCase().startsWith('vault:')) return null;
  const body = raw.slice(6);
  const [pathPart, field] = body.split('#');
  const mount = process.env.VAULT_KV_MOUNT || 'secret';
  const trimmed = pathPart.replace(/^\/+/, '');
  const withData = trimmed.startsWith(`${mount}/data/`)
    ? trimmed
    : trimmed.startsWith(`${mount}/`)
      ? `${mount}/data/${trimmed.slice(mount.length + 1)}`
      : `${mount}/data/${trimmed}`;
  return { apiPath: withData, field: field || null };
}

async function readVaultSecret(apiPath) {
  const addr = String(process.env.VAULT_ADDR || '').replace(/\/$/, '');
  const headers = {
    'X-Vault-Token': process.env.VAULT_TOKEN,
  };
  if (process.env.VAULT_NAMESPACE) headers['X-Vault-Namespace'] = process.env.VAULT_NAMESPACE;
  const response = await fetch(`${addr}/v1/${apiPath}`, {
    headers,
    signal: AbortSignal.timeout(VAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Vault lookup failed (${response.status}) for ${apiPath}: ${text.slice(0, 120)}`);
  }
  const payload = await response.json();
  return payload?.data?.data || payload?.data || {};
}

async function resolveSecretValue(sourceName) {
  const vaultRef = parseVaultRef(sourceName);
  if (vaultRef) {
    if (!vaultEnabled()) throw new Error(`Vault is not configured for reference: ${sourceName}`);
    const data = await readVaultSecret(vaultRef.apiPath);
    if (vaultRef.field) {
      if (data[vaultRef.field] == null) throw new Error(`Vault field missing: ${vaultRef.field}`);
      return String(data[vaultRef.field]);
    }
    const values = Object.values(data);
    if (!values.length) throw new Error(`Vault secret empty: ${sourceName}`);
    return String(values[0]);
  }
  const value = process.env[String(sourceName)];
  if (value === undefined) throw new Error(`Runner secret reference is unavailable: ${sourceName}`);
  return value;
}

async function resolveSecretReferences(secretReferences) {
  const references = secretReferences && typeof secretReferences === 'object' ? secretReferences : {};
  const resolved = {};
  for (const [targetName, sourceName] of Object.entries(references)) {
    resolved[targetName] = await resolveSecretValue(sourceName);
  }
  return resolved;
}

module.exports = {
  vaultEnabled,
  parseVaultRef,
  resolveSecretValue,
  resolveSecretReferences,
};
