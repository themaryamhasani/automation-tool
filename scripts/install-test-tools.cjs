const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execSync } = require('node:child_process');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');

const root = path.resolve(__dirname, '..');
const toolsDir = path.resolve(root, process.env.TEST_TOOLS_DIR || 'runtime/tools');
const isWin = process.platform === 'win32';

const TOOLS = [
  {
    id: 'gitleaks',
    check: 'gitleaks version',
    assets: {
      win32: { url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_windows_x64.zip', bin: 'gitleaks.exe' },
      linux: { url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_linux_x64.tar.gz', bin: 'gitleaks' },
      darwin: { url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_darwin_x64.tar.gz', bin: 'gitleaks' },
    },
  },
  {
    id: 'k6',
    check: 'k6 version',
    assets: {
      win32: { url: 'https://github.com/grafana/k6/releases/download/v0.57.0/k6-v0.57.0-windows-amd64.zip', bin: 'k6-v0.57.0-windows-amd64/k6.exe' },
      linux: { url: 'https://github.com/grafana/k6/releases/download/v0.57.0/k6-v0.57.0-linux-amd64.tar.gz', bin: 'k6-v0.57.0-linux-amd64/k6' },
      darwin: { url: 'https://github.com/grafana/k6/releases/download/v0.57.0/k6-v0.57.0-macos-amd64.zip', bin: 'k6' },
    },
  },
  {
    id: 'semgrep',
    check: 'semgrep --version',
    pip: true,
  },
];

function platformKey() {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function hasCommand(command) {
  try {
    execSync(command, { stdio: 'ignore', env: process.env });
    return true;
  } catch {
    return false;
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        return resolve(download(response.headers.location, dest));
      }
      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`Download failed (${response.statusCode}): ${url}`));
      }
      pipeline(response, file).then(resolve).catch(reject);
    }).on('error', reject);
  });
}

async function extractArchive(archivePath, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    if (isWin) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}' -Force"`, { stdio: 'inherit' });
    } else {
      execSync(`unzip -o ${JSON.stringify(archivePath)} -d ${JSON.stringify(targetDir)}`, { stdio: 'inherit' });
    }
    return;
  }
  execSync(`tar -xzf ${JSON.stringify(archivePath)} -C ${JSON.stringify(targetDir)}`, { stdio: 'inherit' });
}

async function installBinaryTool(tool) {
  const asset = tool.assets[platformKey()];
  if (!asset) throw new Error(`No ${tool.id} asset for ${platformKey()}`);
  const toolDir = path.join(toolsDir, tool.id);
  const binPath = path.join(toolDir, path.basename(asset.bin));
  if (fs.existsSync(binPath)) return binPath;
  await fsp.mkdir(toolDir, { recursive: true });
  const archive = path.join(toolDir, path.basename(asset.url));
  console.log(`Downloading ${tool.id}…`);
  await download(asset.url, archive);
  await extractArchive(archive, toolDir);
  const extracted = path.join(toolDir, asset.bin);
  if (fs.existsSync(extracted) && extracted !== binPath) {
    await fsp.rename(extracted, binPath);
  }
  if (!isWin) await fsp.chmod(binPath, 0o755);
  await fsp.rm(archive, { force: true });
  return binPath;
}

async function installPipTool(_tool) {
  const pip = hasCommand('pip3 --version') ? 'pip3' : hasCommand('pip --version') ? 'pip' : null;
  if (!pip) throw new Error('pip is required to install semgrep');
  execSync(`${pip} install --upgrade semgrep`, { stdio: 'inherit' });
  return 'semgrep';
}

async function main() {
  await fsp.mkdir(toolsDir, { recursive: true });
  const installed = [];
  for (const tool of TOOLS) {
    if (hasCommand(tool.check)) {
      console.log(`${tool.id}: already on PATH`);
      installed.push(tool.id);
      continue;
    }
    if (tool.pip) {
      await installPipTool(tool);
      installed.push(tool.id);
      continue;
    }
    const binPath = await installBinaryTool(tool);
    installed.push(tool.id);
    console.log(`${tool.id}: installed at ${binPath}`);
  }
  const pathHint = isWin ? toolsDir : `${toolsDir}/*/`;
  console.log(JSON.stringify({
    event: 'test-tools-ready',
    installed,
    prependPath: isWin ? toolsDir : toolsDir,
    hint: `Add ${pathHint} subfolders to PATH or set TEST_TOOLS_DIR`,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
