const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function backend() {
  return String(process.env.OBJECT_STORAGE_BACKEND || 'disk').toLowerCase() === 's3' ? 's3' : 'disk';
}

function s3Config() {
  return {
    endpoint: process.env.S3_ENDPOINT || null,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== '0',
  };
}

function isS3Ready() {
  const cfg = s3Config();
  return Boolean(cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function s3Request({ method, key, body, contentType }) {
  const cfg = s3Config();
  if (!cfg.bucket) throw new Error('S3_BUCKET is required for object storage.');
  const host = cfg.endpoint
    ? new URL(cfg.endpoint).host
    : `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  const canonicalUri = cfg.forcePathStyle || cfg.endpoint
    ? `/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
    : `/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = cfg.endpoint
    ? `${cfg.endpoint.replace(/\/$/, '')}${canonicalUri}`
    : `https://${host}${canonicalUri}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body || '');
  const headers = {
    host: new URL(url).host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  if (body) headers['content-length'] = String(Buffer.byteLength(body));

  const signedHeaders = Object.keys(headers).map(item => item.toLowerCase()).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .map(item => item.toLowerCase())
    .sort()
    .map(item => `${item}:${headers[Object.keys(headers).find(key => key.toLowerCase() === item)]}\n`)
    .join('');
  const canonicalRequest = [
    method,
    new URL(url).pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(Number(process.env.OBJECT_STORAGE_TIMEOUT_MS || 60000)),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`S3 ${method} failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response;
}

async function putObject(objectKey, filePath, contentType = 'application/octet-stream') {
  if (backend() !== 's3' || !isS3Ready()) {
    return { backend: 'disk', objectKey: null };
  }
  const body = await fs.readFile(filePath);
  await s3Request({ method: 'PUT', key: objectKey, body, contentType });
  return { backend: 's3', objectKey };
}

async function getObjectToFile(objectKey, targetPath) {
  const response = await s3Request({ method: 'GET', key: objectKey });
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

async function deleteObject(objectKey) {
  if (!objectKey || backend() !== 's3' || !isS3Ready()) return;
  await s3Request({ method: 'DELETE', key: objectKey, body: '' });
}

async function ensureLocalArtifact(artifact, artifactRoot) {
  const localPath = path.resolve(artifactRoot, artifact.relative_path || artifact.relativePath || '');
  if (fsSync.existsSync(localPath)) return localPath;
  if (artifact.storage_backend === 's3' || artifact.storageBackend === 's3') {
    const key = artifact.object_key || artifact.objectKey;
    if (!key) throw new Error('Artifact object key is missing.');
    await getObjectToFile(key, localPath);
    return localPath;
  }
  throw new Error('Artifact file is not available on disk or object storage.');
}

function artifactObjectKey(runId, fileName) {
  return `artifacts/${runId}/${String(fileName || 'file').replace(/[\\/]/g, '_')}`;
}

module.exports = {
  backend,
  isS3Ready,
  s3Config,
  putObject,
  getObjectToFile,
  deleteObject,
  ensureLocalArtifact,
  artifactObjectKey,
};
