const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Monorepo npm workspaces con dos majors de react: la web usa react@18.3.1 (hoisteado en
// la raíz junto a next/@sentry/posthog) y la app usa react@19.2.3 fijado por el SDK 57.
// npm además materializa los peers de react-native-css-interop bajo
// node_modules/nativewind con versiones distintas a las del SDK (reanimated@4.7.1,
// worklets@0.13.0). Con la resolución jerárquica por defecto, nativewind y css-interop
// resolverían esas copias y el bundle saldría con módulos nativos duplicados (crash en
// runtime).
//
// Este shim redirige los paquetes con riesgo de duplicado hacia las copias instaladas
// por expo en apps/mobile/node_modules (fuente de verdad del SDK). El resto de módulos
// usa la búsqueda por defecto, necesaria para dependencias anidadas legítimas
// (p. ej. semver dentro de los paquetes de expo).
const mobileNodeModules = path.join(__dirname, 'node_modules');

const forceWorkspaceVersion = new Set([
  'react',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-is-edge-to-edge',
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const root = moduleName.startsWith('@') ? moduleName.split('/')[1] : moduleName.split('/')[0];
  if (forceWorkspaceVersion.has(root)) {
    return context.resolveRequest(
      { ...context, originPath: path.join(mobileNodeModules, 'shim.js') },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Último recurso: react-native-css-interop (dependencia de nativewind) puede quedar
// anidado en node_modules/nativewind/node_modules según decida npm; sin esta ruta no
// sería resoluble desde la app. Nunca puede tapar apps/mobile ni la raíz.
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.join(path.dirname(require.resolve('nativewind/package.json')), 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
