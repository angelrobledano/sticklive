// @ts-check
// Flat config de ESLint 9 para el monorepo (TS/TSX). Una sola config en la raíz;
// cada paquete corre `eslint src` y la encuentra subiendo de directorio.
// Línea base pragmática: las reglas opinables van a `warn` para no bloquear el
// pipeline, y se pueden subir a `error` de forma incremental.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.config.{js,cjs,mjs,ts}',
      '**/next-env.d.ts',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,

  // Reglas base de TypeScript para todo el monorepo.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // TS ya resuelve identificadores; en flat config no-undef da falsos positivos.
      'no-undef': 'off',
      // Logging operativo intencionado (scrapers / ETL).
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // Usar la versión de @typescript-eslint, ignorando args/vars con prefijo _.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
    },
  },

  // Service worker: `self`, `clients`, `caches`… son globales del contexto de
  // worker, no del navegador. Sin esto, `no-undef` marcaba 9 falsos positivos
  // en sw.js y obligaba a dejar el job de lint en no-bloqueante.
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  // Reglas específicas del frontend (React hooks + Next). Solo apps/web.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'warn',
    },
  },
];
