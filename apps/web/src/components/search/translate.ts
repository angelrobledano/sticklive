/**
 * Traducción con respaldo local en español.
 *
 * Las claves nuevas de i18n las añade el coordinador a los locales; hasta
 * entonces `t(key)` devuelve la propia clave. `tt` detecta ese caso y usa el
 * texto español embebido, para que la UI nunca muestre una clave cruda.
 */
export function tt(
  t: (key: string, vars?: Record<string, string | number>) => string,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  const value = t(key, vars);
  if (value !== key) return value;
  if (!vars) return fallback;
  let text = fallback;
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}
