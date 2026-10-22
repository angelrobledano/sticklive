import type { Locale } from '@/lib/locales';
import es from '@/locales/es.json';
import ca from '@/locales/ca.json';
import en from '@/locales/en.json';
import pt from '@/locales/pt.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { es, ca, en, pt, fr, it };

function lookup(dict: Dict, path: string): string | null {
  let node: unknown = dict;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Dict)[key];
  }
  return typeof node === 'string' ? node : null;
}

/**
 * `t(key, vars)` fuera de React (rutas de imagen, funciones puras): mismo
 * contrato que useT, con caída a español y, si tampoco existe, a la clave.
 */
export function serverT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>): string => {
    const raw = lookup(DICTS[locale] ?? DICTS.es, key) ?? lookup(DICTS.es, key) ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
  };
}
