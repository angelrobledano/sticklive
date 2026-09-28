/**
 * Detector de finales por desaparición del feed mc (#374).
 *
 * Problema: el estado `finished` sólo llega con la señal del feed
 * (`scorer_game_final` / "FINAL") o por el calendario horario. Si un partido
 * `live` con marcador desaparece del feed ANTES de que un ciclo vea FINAL, se
 * queda "EN VIVO" falso hasta el `stale-live-watchdog` (5 h) — o hasta que el
 * calendario lo finalice (1 h más).
 *
 * Señal barata y conservadora: el feed `rfep_mc_1.php` es GLOBAL y lista todos
 * los partidos activos. Un `live` con marcador que desaparece N ciclos
 * CONSECUTIVOS (y el feed sigue respondiendo) es casi seguro un final. Se marca
 * `finished` conservando el último marcador; si reaparece, el upsert lo corrige
 * (y queda registrado como regresión `finished→live`, ver status-regression.ts).
 *
 * La decisión vive aquí, pura y testeable. El estado (contador) es por proceso:
 * si `cron-live` reinicia, la cuenta se pierde y el peor caso vuelve al
 * watchdog, nunca marca un final falso.
 */
export class MissingLiveTracker {
  /** `source_ref` → nº de ciclos consecutivos ausente del feed. */
  private misses = new Map<string, number>();

  constructor(private readonly threshold: number) {
    if (threshold < 1) throw new Error('MissingLiveTracker: threshold debe ser >= 1');
  }

  /**
   * Registra un ciclo. `candidates` son los `live` conocidos en BD y `seen` los
   * que el feed acaba de listar. Devuelve los que superan el umbral de ausencia
   * (y los deja de contar: en el ciclo siguiente el ETL ya los ve `finished`).
   */
  observe(candidates: readonly string[], seen: ReadonlySet<string>): string[] {
    const toFinalize: string[] = [];
    const next = new Map<string, number>();

    for (const ref of candidates) {
      if (seen.has(ref)) continue; // presente → resetea su cuenta
      const cycles = (this.misses.get(ref) ?? 0) + 1;
      if (cycles >= this.threshold) toFinalize.push(ref);
      else next.set(ref, cycles);
    }

    this.misses = next;
    return toFinalize;
  }

  /** Olvida todas las cuentas (p. ej. al recuperar la fuente). */
  reset(): void {
    this.misses.clear();
  }
}
