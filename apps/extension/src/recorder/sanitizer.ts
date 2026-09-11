import type { SanitizationResult } from './types';

const SENSITIVE_HINTS = /password|passwd|passcode|pin(?:\b|_)|secret|token|api[-_ ]?key|authorization|auth[-_ ]?code|access[-_ ]?key|session[-_ ]?id|credit[-_ ]?card|card[-_ ]?number|cvc|cvv/i;
const COOKIE_APIS = /\b(?:addCookies|storageState)\s*\(|document\.cookie\s*=/i;
const SECRET_LITERAL = /^(?:bearer\s+|basic\s+|atk_|sk-|ghp_|github_pat_|eyJ[a-zA-Z0-9_-]*\.)|^[A-Za-z0-9_\-+/]{32,}={0,2}$/i;

function environmentName(line: string): string {
  if (/credit[-_ ]?card|card[-_ ]?number/i.test(line)) return 'TEST_CARD_NUMBER';
  if (/cvc|cvv/i.test(line)) return 'TEST_CARD_CVC';
  if (/api[-_ ]?key|access[-_ ]?key/i.test(line)) return 'TEST_API_KEY';
  if (/token|authorization|auth[-_ ]?code/i.test(line)) return 'TEST_TOKEN';
  if (/pin/i.test(line)) return 'TEST_PIN';
  if (/password|passwd|passcode/i.test(line)) return 'TEST_PASSWORD';
  return 'TEST_SECRET';
}

function unquoteLiteral(value: string): string {
  return value.slice(1, -1).replace(/\\(['"`\\])/g, '$1');
}

function sanitizeInputLine(line: string, envVars: Set<string>): { line: string; changed: boolean } {
  const call = /\.(fill|type)\(\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*")|(?:`(?:\\.|[^`\\])*`))\s*\)/g;
  let changed = false;
  const next = line.replace(call, (match, method: string, literal: string, offset: number) => {
    const locatorPart = line.slice(0, offset);
    const value = unquoteLiteral(literal);
    if (!SENSITIVE_HINTS.test(locatorPart) && !SECRET_LITERAL.test(value.trim())) return match;
    const env = environmentName(`${locatorPart} ${value}`);
    envVars.add(env);
    changed = true;
    return `.${method}(process.env.${env} ?? '')`;
  });
  return { line: next, changed };
}

function sanitizeHeaders(line: string, envVars: Set<string>): { line: string; changed: boolean } {
  let changed = false;
  const next = line.replace(
    /((?:authorization|x-api-key|api-key|access-token)['"]?\s*:\s*)((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))/gi,
    (_match, prefix: string) => {
      changed = true;
      const env = /api-key/i.test(prefix) ? 'TEST_API_KEY' : 'TEST_TOKEN';
      envVars.add(env);
      return `${prefix}process.env.${env} ?? ''`;
    },
  );
  return { line: next, changed };
}

function sanitizeCookieHeaders(line: string): { line: string; changed: boolean } {
  let changed = false;
  const next = line.replace(
    /((?:['"])?(?:cookie|set-cookie)(?:['"])?\s*:\s*)((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))/gi,
    (_match, prefix: string) => {
      changed = true;
      return prefix + "''";
    },
  );
  return { line: next, changed };
}

function parenthesisDelta(line: string): number {
  return [...line].reduce((depth, character) => depth + (character === '(' ? 1 : character === ')' ? -1 : 0), 0);
}

function protectIndirectSensitiveValues(source: string, envVars: Set<string>): { source: string; changed: boolean } {
  const declaration = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*")|(?:`(?:\\.|[^`\\])*`))/g;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const match of source.matchAll(declaration)) {
    const name = match[2];
    const literal = match[3];
    const value = unquoteLiteral(literal);
    const usedBySensitiveInput = new RegExp(`(?:password|passwd|passcode|secret|token|api[-_ ]?key|authorization|card|cvc|cvv|pin)[^\\n]{0,180}\\.(?:fill|type)\\(\\s*${name}\\s*\\)`, 'i').test(source);
    const sensitive = SENSITIVE_HINTS.test(name) || SECRET_LITERAL.test(value.trim()) || usedBySensitiveInput;
    if (!sensitive || !new RegExp(`\\.(?:fill|type)\\(\\s*${name}\\s*\\)`).test(source)) continue;
    const env = environmentName(`${name} ${usedBySensitiveInput ? 'password' : value}`);
    envVars.add(env);
    const literalOffset = match[0].lastIndexOf(literal);
    replacements.push({ start: (match.index || 0) + literalOffset, end: (match.index || 0) + literalOffset + literal.length, text: `process.env.${env} ?? ''` });
  }
  let next = source;
  for (const replacement of replacements.reverse()) next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  return { source: next, changed: replacements.length > 0 };
}

export function sanitizeSource(source: string): SanitizationResult {
  const warnings = new Set<string>();
  const environmentVariables = new Set<string>();
  const lines: string[] = [];
  const indirect = protectIndirectSensitiveValues(source.replace(/\r\n?/g, '\n'), environmentVariables);
  let changed = indirect.changed;
  if (indirect.changed) warnings.add('Sensitive input values were replaced with Runner environment variables.');
  let sensitiveCallDepth = 0;

  for (const line of indirect.source.split('\n')) {
    if (sensitiveCallDepth > 0) {
      sensitiveCallDepth += parenthesisDelta(line);
      continue;
    }
    if (COOKIE_APIS.test(line)) {
      changed = true;
      warnings.add('Cookie or storage-state code was removed and will never be uploaded.');
      sensitiveCallDepth = Math.max(0, parenthesisDelta(line));
      lines.push(`${line.match(/^\s*/)?.[0] || ''}// Sensitive browser state removed by Automation Tool.`);
      continue;
    }
    const input = sanitizeInputLine(line, environmentVariables);
    const headers = sanitizeHeaders(input.line, environmentVariables);
    const cookieHeaders = sanitizeCookieHeaders(headers.line);
    if (cookieHeaders.changed) warnings.add('Cookie header values were removed and will never be uploaded.');
    if (input.changed || headers.changed || cookieHeaders.changed) {
      changed = true;
      if (input.changed || headers.changed) warnings.add('Sensitive input values were replaced with Runner environment variables.');
    }
    lines.push(cookieHeaders.line);
  }

  return {
    source: lines.join('\n'),
    warnings: [...warnings],
    environmentVariables: [...environmentVariables].sort(),
    changed,
  };
}
