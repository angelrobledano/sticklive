const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['dist/*']),
  expoConfig,
  {
    // tailwind.config.ts usa require('nativewind/preset'), patrón documentado de
    // NativeWind (fichero de config CJS); la regla de imports require no aplica ahí.
    files: ['tailwind.config.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
