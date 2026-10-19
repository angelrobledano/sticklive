/**
 * Preferencia de tema: sistema, claro u oscuro.
 *
 * El valor guardado en localStorage es `'light'` o `'dark'`; la ausencia de
 * clave significa "sistema". Así el script de arranque del layout sigue
 * funcionando sin cambios y no hay que migrar nada de lo ya guardado.
 *
 * La lógica vive fuera del hook para poder fijarla con tests sin DOM.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Normaliza lo que haya en localStorage (incluido basura) a una preferencia. */
export function storedTheme(raw: string | null): ThemePref {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** Resuelve la preferencia contra la del sistema operativo. */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light';
  return pref;
}
