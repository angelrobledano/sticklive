// Los JSON viven en la web (fuente única de traducciones). Import en relativo,
// mismo patrón que el ETL con notification-copy: el bundler los copia al bundle.
import ca from '../../../web/src/locales/ca.json';
import en from '../../../web/src/locales/en.json';
import es from '../../../web/src/locales/es.json';
import fr from '../../../web/src/locales/fr.json';
import it from '../../../web/src/locales/it.json';
import pt from '../../../web/src/locales/pt.json';

export type Locale = 'ca' | 'en' | 'es' | 'fr' | 'it' | 'pt';

export const LOCALES: Locale[] = ['ca', 'en', 'es', 'fr', 'it', 'pt'];

export const dictionaries: Record<Locale, Record<string, unknown>> = { ca, en, es, fr, it, pt };

/** Resuelve una clave punteada ('a.b.c') en el diccionario; fallback: la clave. */
export function resolveKey(dict: Record<string, unknown>, key: string): string {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}

/** Sustituye `{var}` por su valor (paridad con `t(key, vars)` de la web). */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
