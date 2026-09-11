const parser = require('@babel/parser');
const { ApiError } = require('../http.cjs');

const SENSITIVE_NAME = /password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|session[_-]?id|card[_-]?(?:number|cvc|cvv)|\bpin\b/i;
const SENSITIVE_LOCATOR = /password|passwd|passcode|secret|token|api[-_ ]?key|authorization|credit[-_ ]?card|card[-_ ]?(?:number|cvc|cvv)|\bpin\b/i;
const BEARER = /^\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\s*$/i;
const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const KEY_PREFIX = /^(?:atk_|eat_|ert_|sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{8,}$/i;

function literalValue(node, bindings) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value?.cooked || '';
  if (node.type === 'Identifier') return bindings.get(node.name)?.value ?? null;
  return null;
}

function propertyName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  return '';
}

function sourceValidation(source) {
  if (typeof source !== 'string' || !source.trim()) {
    return { valid: false, issues: [{ line: 1, category: 'invalid_source', severity: 'error', message: 'Test source is required.', suggestedRemediation: 'Record the test again or provide Playwright Test source.' }] };
  }
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript'], errorRecovery: false });
  } catch (error) {
    return { valid: false, issues: [{ line: error.loc?.line || 1, category: 'syntax', severity: 'error', message: 'The Playwright source is not valid TypeScript.', suggestedRemediation: 'Open Advanced, correct the highlighted syntax, and try again.' }] };
  }

  const bindings = new Map();
  const issues = [];
  const seen = new Set();
  const add = (node, category, message, suggestedRemediation) => {
    const line = node?.loc?.start?.line || 1;
    const key = `${line}:${category}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ line, category, severity: 'error', message, suggestedRemediation });
  };

  function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const value = literalValue(node.init, bindings);
      if (value != null) bindings.set(node.id.name, { value, line: node.loc?.start?.line || 1 });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') collect(value);
    }
  }
  collect(ast);

  function inspect(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'AssignmentExpression'
      && node.left?.type === 'MemberExpression'
      && propertyName(node.left.property).toLowerCase() === 'cookie') {
      add(node, 'cookie_write', 'This test writes browser cookies directly.', 'Remove document.cookie usage and perform login through test steps or configured test credentials.');
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const value = literalValue(node.init, bindings);
      if (value && SENSITIVE_NAME.test(node.id.name)) {
        add(node, 'credential_variable', 'This test assigns a hard-coded value to a credential-like variable.', 'Read the value from a project environment variable instead.');
      }
    }
    if (node.type === 'ObjectProperty') {
      const key = propertyName(node.key).toLowerCase();
      const value = literalValue(node.value, bindings);
      if (value && ['authorization', 'x-api-key', 'api-key', 'access-token'].includes(key)) {
        add(node, 'authorization_header', 'This test contains a hard-coded authentication header.', 'Replace the value with a project environment variable.');
      }
      if (value && ['cookie', 'set-cookie'].includes(key)) {
        add(node, 'cookie_header', 'This test contains a hard-coded cookie header.', 'Remove the cookie and include login steps or configured test credentials.');
      }
      if (value && SENSITIVE_NAME.test(key) && !['authorization', 'x-api-key', 'api-key', 'access-token', 'cookie', 'set-cookie'].includes(key)) {
        add(node, 'credential_property', 'This test contains a hard-coded credential-like property.', 'Replace the value with a project environment variable.');
      }
      if (key === 'storagestate' && node.value?.type !== 'NullLiteral') {
        add(node, 'storage_state', 'This test persists browser storage state.', 'Remove storageState credentials; Automation Tool does not transfer personal browser sessions.');
      }
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const method = callee?.type === 'MemberExpression' ? propertyName(callee.property) : '';
      if (method === 'fill' || method === 'type') {
        const value = literalValue(node.arguments?.[0], bindings);
        const objectStart = callee.object?.start;
        const objectEnd = callee.object?.end;
        const context = Number.isInteger(objectStart) && Number.isInteger(objectEnd) ? source.slice(objectStart, objectEnd) : '';
        const argument = node.arguments?.[0];
        const bindingName = argument?.type === 'Identifier' ? argument.name : '';
        if (value && (SENSITIVE_LOCATOR.test(context) || SENSITIVE_NAME.test(bindingName) || BEARER.test(value) || JWT.test(value) || KEY_PREFIX.test(value))) {
          add(node, 'sensitive_input', 'This test fills a value that looks sensitive.', 'Replace it with an environment reference such as process.env.TEST_PASSWORD.');
        }
      }
      if (method === 'addCookies' || method === 'storageState') {
        add(node, method === 'addCookies' ? 'cookie_state' : 'storage_state', 'This test includes browser authentication state.', 'Remove browser-state transfer and use explicit login steps or Runner secrets.');
      }
    }
    if (node.type === 'StringLiteral' && node.value && (BEARER.test(node.value) || JWT.test(node.value) || KEY_PREFIX.test(node.value))) {
      add(node, 'credential_literal', 'This test contains a value that looks like a credential.', 'Replace the literal with a project environment variable.');
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value && typeof value === 'object') inspect(value);
    }
  }
  inspect(ast);
  return { valid: issues.length === 0, issues: issues.sort((a, b) => a.line - b.line) };
}

function assertSafePlaywrightSource(source) {
  const result = sourceValidation(source);
  if (!result.valid) {
    throw new ApiError(422, 'SECRET_VALIDATION_FAILED', 'This test contains sensitive data that must be replaced before saving.', result);
  }
  return result;
}

module.exports = { sourceValidation, assertSafePlaywrightSource };
