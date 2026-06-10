import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Pragmatic for this codebase: chat artifacts, SSE payloads and Mongo
      // documents are intentionally loose shapes — visible as warnings, not errors.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Provider + hook co-location (theme.tsx, auth.tsx) is idiomatic React;
      // fast-refresh purity is a DX nicety, not correctness.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
