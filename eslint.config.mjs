// Code checks beyond what TypeScript itself enforces.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'Data/', 'test-results/', 'playwright-report/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // Plain Node.js scripts: the build's own tools, and the stand-in assistant the tests talk to.
    files: ['scripts/**/*.mjs', 'tests/fixtures/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly' } },
  },
);
