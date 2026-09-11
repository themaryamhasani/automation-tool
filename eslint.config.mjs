import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'runtime', 'artifacts', 'test-results', 'playwright-report', 'apps/web/node_modules', 'apps/web/dist', 'apps/extension/dist'] },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/extension/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['apps/extension/vite.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
  {
    files: ['apps/api/**/*.cjs', 'apps/runner/**/*.cjs', 'shared/**/*.cjs', 'tests/**/*.cjs', 'scripts/**/*.cjs'],
    ...js.configs.recommended,
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
    },
  },
);
