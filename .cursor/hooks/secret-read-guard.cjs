#!/usr/bin/env node
/**
 * beforeReadFile guard: discourage reading secret-bearing .env files.
 * Allows .env.example. Fail-open on parse errors.
 */
const fs = require('node:fs');
const path = require('node:path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function allow() {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}

function ask(userMessage, agentMessage) {
  process.stdout.write(JSON.stringify({
    permission: 'ask',
    user_message: userMessage,
    agent_message: agentMessage,
  }));
}

const raw = readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  allow();
  process.exit(0);
}

const filePath = String(payload.file_path || payload.path || payload.filePath || '');
const base = path.basename(filePath).toLowerCase();

if (base === '.env' || /^\.env\.(local|production|development|staging)$/i.test(base)) {
  ask(
    'Allow reading a secret-bearing env file? Prefer .env.example for variable names only.',
    'AGENTS.md: never read/print .env secret values. Use .env.example for names.',
  );
  process.exit(0);
}

allow();
