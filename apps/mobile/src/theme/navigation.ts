import { DarkTheme, DefaultTheme } from 'expo-router';
import { BRAND } from '@sports/brand';

/**
 * Temas de navegación (React Navigation) para expo-router. Sin esto, la
 * cabecera de la pila y la barra de pestañas se quedan con el tema claro por
 * defecto aunque la app esté en oscuro. Los colores salen de los tokens de
 * marca y del mismo lienzo que usa la interfaz (noche #0B1220 en oscuro).
 */
export const NAV_LIGHT = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: BRAND.granate,
    background: '#f8fafc',
    card: '#ffffff',
    text: '#0f172a',
    border: '#e2e8f0',
    notification: BRAND.granate,
  },
} as const;

export const NAV_DARK = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: BRAND.accent,
    background: BRAND.noche,
    card: '#111a2e',
    text: '#f8fafc',
    border: '#1e293b',
    notification: BRAND.accent,
  },
} as const;
