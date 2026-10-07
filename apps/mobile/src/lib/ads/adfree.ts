import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ad-free recompensado (Plan D Task 2): ver un anuncio rewarded concede N
 * minutos sin anuncios, persistentes en AsyncStorage. El estado se integra
 * como capa más del guard `shouldShowAds` (queries.ts) — misma regla de
 * dinero: ante cualquier duda, el adfree NO se activa.
 */

/** Clave del timestamp de caducidad en AsyncStorage (string-only). */
const ADFREE_KEY = 'ads.adfree_until';

const MINUTE_MS = 60_000;

/**
 * ¿Está activo el ad-free? Puro y fail-closed: ante cualquier timestamp
 * dudoso (null, undefined, NaN, Infinity) devuelve false — un valor basura
 * jamás puede regalar minutos sin anuncios. `> now` (no `>=`): caduca en el
 * instante exacto, sin frame de gracia.
 */
export function isAdfreeActive(
  now: number,
  adfreeUntil: number | null | undefined,
): boolean {
  return (
    typeof adfreeUntil === 'number' &&
    Number.isFinite(adfreeUntil) &&
    adfreeUntil > now
  );
}

/**
 * Nueva caducidad tras ver un rewarded: los minutos se acumulan DESDE la
 * caducidad vigente (no desde ahora) — ver dos anuncios seguidos ⇒ 60 min
 * reales, no 30 solapados. Si el adfree previo ya caducó (o no existe), la
 * base vuelve a ser ahora.
 */
export function extendAdfree(
  now: number,
  currentUntil: number | null | undefined,
  minutes: number,
): number {
  const base = isAdfreeActive(now, currentUntil) ? (currentUntil as number) : now;
  return base + minutes * MINUTE_MS;
}

/**
 * Tipo del reward configurado en el panel de AdMob (contrato del API): el
 * anuncio paga `adfree_min × adfreeMinutes` (30 por defecto). El valor del
 * premio lo gobierna el API — lo que pague el anuncio se VERIFICA contra
 * este contrato y cualquier desvío NO concede nada (regla de dinero: el
 * contenido de un anuncio es input no confiable). Si ops cambia
 * ADS_REWARDED_ADFREE_MINUTES, debe espejar el amount en AdMob.
 */
export const REWARD_TYPE = 'adfree_min';

/**
 * Verifica el contrato del reward y devuelve el nuevo adfree_until, o null
 * si el anuncio no cumple lo configurado (mismatch de type/amount ⇒ no se
 * concede). PURA y testeada: la concesión es la decisión de dinero, no un
 * efecto del componente. `reward` puede llegar incompleto del SDK → null.
 */
export function grantAdfreeReward(
  reward: { type: string; amount: number } | null | undefined,
  adfreeMinutes: number,
  currentUntil: number | null,
  now: number,
): number | null {
  if (reward?.type !== REWARD_TYPE || reward?.amount !== adfreeMinutes) return null;
  return extendAdfree(now, currentUntil, adfreeMinutes);
}

/**
 * Lee el adfree_until persistido. Parseo DEFENSIVO: cualquier basura en el
 * storage (no numérico, NaN, Infinity) ⇒ null — "los malos datos son peores
 * que no tener datos". Nunca lanza: el gating consulta esto en cualquier
 * render, y un fallo de storage solo puede costar adfree del usuario
 * (fail-closed en la dirección correcta: no se regala), nunca romper la UI.
 */
export async function getAdfreeUntil(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(ADFREE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.warn('[ads] no se pudo leer adfree_until', error);
    return null;
  }
}

/**
 * Persiste la nueva caducidad. PROPAGA errores: el llamador (RewardedCard)
 * debe mostrarlos — el usuario vio el anuncio y si el premio no se guarda,
 * el fallo es visible y queda en analítica (nunca silencio).
 */
export async function setAdfreeUntil(until: number): Promise<void> {
  await AsyncStorage.setItem(ADFREE_KEY, String(until));
}
