// Declaraciones de módulos sin tipos propios.
//
// `*.css`: el layout raíz de expo-router importa '../global.css' (patrón
// NativeWind) y nativewind 4.2.7 no trae declaración para side-effect imports
// de CSS; sin esto tsc falla con TS2882.
declare module '*.css';
