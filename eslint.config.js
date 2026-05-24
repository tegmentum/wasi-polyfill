// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Things ESLint should never look at. test/fixtures holds WASM guest sources
    // and build scripts (their own runtime/globals), not library code.
    ignores: [
      'dist/**',
      'dist-e2e/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'test/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // TypeScript already resolves identifiers; ESLint's core no-undef produces
      // false positives on TS-only globals/types, so the typescript-eslint guide
      // recommends disabling it for .ts files.
      'no-undef': 'off',
      // The codebase already enforces unused-locals/params via tsconfig; mirror it
      // here but allow leading-underscore opt-outs (used widely for ignored args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `any` is used pragmatically at WASM/host boundaries; warn rather than block
      // so it shows up without failing the build. Tighten over time (ratchet).
      '@typescript-eslint/no-explicit-any': 'warn',
      // The `Function` type is used at the WASM/jco trampoline boundary where the
      // precise signature is genuinely unknown; warn (ratchet) rather than block.
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // `const self = this` shows up in a few async wrappers; low value to block.
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // WASI plugins legitimately use empty methods / interface stubs.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Tests may be looser: scaffolding churns and intentionally keeps unused
    // fixtures, so demote the noisy rules to warnings there.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  }
)
