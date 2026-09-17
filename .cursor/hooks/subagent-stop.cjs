#!/usr/bin/env node
/**
 * subagentStop: nudge parent to consume structured output and continue the graph.
 * Does not spawn more subagents; fail-open.
 */
const fs = require('node:fs');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const raw = readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const agent = String(
  payload.subagent_type
  || payload.subagentType
  || payload.agent
  || payload.name
  || 'subagent',
);

const projectAgents = new Set([
  'architecture-guardian',
  'run-pipeline-engineer',
  'source-approach-engineer',
  'chrome-recorder-engineer',
  'schema-migration-engineer',
  'platform-verifier',
  'auth-crypto-guardian',
]);

if (!projectAgents.has(agent) && !/guardian|engineer|verifier/i.test(agent)) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const followup = [
  `Parent: merge ${agent} structured output (Summary/Findings/Files/Decisions/Risks/Verification/Recommendations/Blockers).`,
  'Do not re-explore the same paths.',
  'If Recommendations name another specialist or platform-verifier, continue the dependency graph with a short JSON handoff only.',
  'If this was an implementer and verification_required, run platform-verifier / skill platform-verify before claiming done.',
].join(' ');

process.stdout.write(JSON.stringify({ followup_message: followup }));
