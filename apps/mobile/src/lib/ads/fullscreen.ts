import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Presupuesto de PANTALLA COMPLETA compartido (Plan D Task 4): app open
 * (Task 4) e interstitial (Task 5) beben del MISMO presupuesto — máx 2/hora,
 * mínimo 20 min entre shows, nunca en las 2 primeras sesiones del usuario,
 * nunca tras interacción de push (la marca de push vive en session-context.ts).
 *
 * La DECISIÓN es pura y testeada (`canShowFullScreen` / `registerFullScreenShow`);
 * el storage (`ads.fullscreen_state` en AsyncStorage) es best-effort (plan,
 * riesgos §5): no es seguridad, es un contador de UX — basura ⇒ presupuesto
 * fresco (defaults), nunca excepción. El peor caso de un fallo de escritura
 * es que el cap permita un show de más, nunca que rompa la app.
 */

/** Mínimo entre shows de CUALQUIER full-screen (app open + interstitial). */
export const MIN_FULL_SCREEN_INTERVAL_MS = 20 * 60_000;

/** Máximo de shows de full-screen por hora (bucket compartido). */
export const MAX_FULL_SCREEN_PER_HOUR = 2;

/**
 * Grace period (doc de Google: "wait until users have used your app a few
 * times"): nada de full-screen en las 2 primeras sesiones (invariante 3).
 */
export const FULL_SCREEN_GRACE_SESSIONS = 2;

export interface FullScreenBudgetState {
  lastShownAt: number | null;
  showsThisHour: number;
  hourBucket: string;
}

export interface FullScreenGateInput extends FullScreenBudgetState {
  enabled: boolean;
  now: number;
  sessionCount: number;
  fromPush: boolean;
}

/** Clave del presupuesto compartido en AsyncStorage (JSON string-only). */
const FULLSCREEN_STATE_KEY = 'ads.fullscreen_state';

const FRESH_BUDGET: FullScreenBudgetState = {
  lastShownAt: null,
  showsThisHour: 0,
  hourBucket: '',
};

/**
 * Bucket horario UTC `YYYY-MM-DDTHH` — SOLO agrupa "misma hora" para el cap
 * 2/hora: es determinista entre máquinas y husos (y testeable), que es lo
 * único que un cap necesita; no representa la hora local del usuario.
 */
export function hourBucketOf(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

/**
 * ¿Se puede mostrar un full-screen (app open / interstitial)? PURA. Orden de
 * los checks (plan): enabled → grace (≤ 2 sesiones) → push → intervalo mínimo
 * (20 min) → cap horario (2, con reset por bucket). Fail-closed: sessionCount
 * no entero cuenta como sesión nueva (grace bloquea), enabled no-true bloquea.
 */
export function canShowFullScreen(state: FullScreenGateInput): boolean {
  if (state.enabled !== true) return false;
  if (
    !(Number.isInteger(state.sessionCount) && state.sessionCount > FULL_SCREEN_GRACE_SESSIONS)
  ) {
    return false;
  }
  if (state.fromPush) return false;
  if (
    state.lastShownAt !== null &&
    state.now - state.lastShownAt < MIN_FULL_SCREEN_INTERVAL_MS
  ) {
    return false;
  }
  if (
    state.hourBucket === hourBucketOf(state.now) &&
    state.showsThisHour >= MAX_FULL_SCREEN_PER_HOUR
  ) {
    return false;
  }
  return true;
}

/**
 * Nuevo estado tras MOSTRARSE un full-screen (solo se llama si llegó a
 * mostrarse): lastShownAt=now y showsThisHour+1 SI el bucket sigue siendo el
 * actual; si cambió la hora, el contador reinicia en 1 (reset por bucket).
 */
export function registerFullScreenShow(
  state: FullScreenBudgetState,
  now: number,
): FullScreenBudgetState {
  const bucket = hourBucketOf(now);
  const showsThisHour = state.hourBucket === bucket ? state.showsThisHour + 1 : 1;
  return { lastShownAt: now, showsThisHour, hourBucket: bucket };
}

function isBudgetLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee el presupuesto persistido. Parseo DEFENSIVO campo a campo: cualquier
 * basura en el storage (no JSON, JSON no-objeto, tipos inesperados, NaN,
 * negativos) ⇒ default para ese campo — "los malos datos son peores que no
 * tener datos". Nunca lanza: el gating consulta esto en cualquier arranque y
 * un fallo de storage solo puede costar un cap (nunca romper la UI).
 */
export async function getFullScreenBudget(): Promise<FullScreenBudgetState> {
  try {
    const raw = await AsyncStorage.getItem(FULLSCREEN_STATE_KEY);
    if (raw === null) return { ...FRESH_BUDGET };
    const parsed: unknown = JSON.parse(raw);
    if (!isBudgetLike(parsed)) return { ...FRESH_BUDGET };
    return {
      lastShownAt:
        typeof parsed.lastShownAt === 'number' && Number.isFinite(parsed.lastShownAt)
          ? parsed.lastShownAt
          : null,
      showsThisHour:
        typeof parsed.showsThisHour === 'number' &&
        Number.isInteger(parsed.showsThisHour) &&
        parsed.showsThisHour >= 0
          ? parsed.showsThisHour
          : 0,
      hourBucket: typeof parsed.hourBucket === 'string' ? parsed.hourBucket : '',
    };
  } catch (error) {
    console.warn('[ads] no se pudo leer el presupuesto full-screen', error);
    return { ...FRESH_BUDGET };
  }
}

/**
 * Persiste el presupuesto tras un show. BEST-EFFORT: el anuncio YA se mostró,
 * así que un fallo de storage no tiene arreglo visible — se loguea (nunca
 * silencio) y se continúa. El peor caso es que el cap permita un show de más.
 */
export async function setFullScreenBudget(state: FullScreenBudgetState): Promise<void> {
  try {
    await AsyncStorage.setItem(FULLSCREEN_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[ads] no se pudo guardar el presupuesto full-screen', error);
  }
}
