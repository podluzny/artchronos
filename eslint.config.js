import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '.dependency-cruiser.cjs',
      'dist/**',
      '.vercel/**',
      'test-results/**',
      'public/**',
      'node_modules/**',
      'assets/**',
      '.adminjs/**',
      'src/adminjs/components/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
