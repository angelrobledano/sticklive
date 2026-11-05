import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['react', 'react-*', 'react/*', 'next', 'next/*', 'expo', 'expo-*', '@expo/*', '@/*'],
      }],
    },
  },
];
