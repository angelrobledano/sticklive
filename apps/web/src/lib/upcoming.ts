/**
 * upcoming.ts — estructura de la vista "Próximos partidos" de la home (la que
 * se muestra cuando el día seleccionado no tiene partidos).
 *
 * Antes la lista era plana por día: cada tarjeta llevaba su etiqueta de
 * competición flotando encima y en una columna ancha el conjunto se leía como
 * una sopa de filas estiradas (#414). Ahora la agrupación es día → competición
 * → partidos, el mismo lenguaje de secciones que la jornada de la portada.
 *
 * Función pura, sin React: testeable sin navegador.
 */
import { madridDateKey } from '@/lib/match-time';
import { importanceRank } from '@/lib/competition-importance';

/**
 * Firma estructural (mínimo que necesita el agrupado) para no acoplar el test
 * al tipo completo de `Match`; los objetos de la API lo satisfacen tal cual.
 */
export interface UpcomingMatch {
  id: string;
  scheduledAt: string | null;
  competitionId?: string | null;
  competitionName?: string | null;
  competitionSlug?: string | null;
}

export interface UpcomingCompetitionGroup<T = UpcomingMatch> {
  /** Nombre de la competición; `null` → el llamante pone su etiqueta i18n. */
  name: string | null;
  /** Para enlazar a la competición (el del primer partido del grupo). */
  id: string | null;
  /** Slug de la competición: orden por importancia, como /competiciones. */
  slug: string | null;
  matches: T[];
}

export interface UpcomingDayGroup<T = UpcomingMatch> {
  dateKey: string;
  competitions: UpcomingCompetitionGroup<T>[];
  total: number;
}

/** Instante del partido (o 0 si falta / es inválido) para ordenar establemente. */
function timeOf(m: UpcomingMatch): number {
  const t = Date.parse(m.scheduledAt ?? '');
  return Number.isFinite(t) ? t : 0;
}

/**
 * Partidos de días POSTERIORES al seleccionado, agrupados por día y, dentro de
 * cada día, por competición. Días ascendentes; competiciones por IMPORTANCIA —
 * el mismo criterio que /competiciones y la jornada del día (#414) —, partidos
 * por hora dentro de su grupo.
 */
export function groupUpcomingByDay<T extends UpcomingMatch>(
  matches: T[],
  selectedDate: string,
  locale = 'es',
): UpcomingDayGroup<T>[] {
  const days = new Map<string, Map<string, T[]>>();
  for (const m of matches) {
    const dateKey = madridDateKey(m.scheduledAt);
    if (!dateKey || dateKey <= selectedDate) continue;
    const compKey = m.competitionId || m.competitionName || '';
    let day = days.get(dateKey);
    if (!day) {
      day = new Map();
      days.set(dateKey, day);
    }
    const arr = day.get(compKey);
    if (arr) arr.push(m);
    else day.set(compKey, [m]);
  }

  const out: UpcomingDayGroup<T>[] = [];
  for (const [dateKey, day] of days) {
    const competitions: UpcomingCompetitionGroup<T>[] = [...day.entries()].map(([, ms]) => {
      const sorted = [...ms].sort((a, b) => timeOf(a) - timeOf(b));
      const first = sorted[0];
      return {
        name: first?.competitionName ?? null,
        id: first?.competitionId ?? null,
        slug: first?.competitionSlug ?? null,
        matches: sorted,
      };
    });
    // Importancia (tabla compartida con /competiciones); empate → nombre.
    competitions.sort((a, b) => {
      const d = importanceRank(a.slug) - importanceRank(b.slug);
      return d !== 0 ? d : (a.name ?? '').localeCompare(b.name ?? '', locale);
    });
    out.push({
      dateKey,
      competitions,
      total: competitions.reduce((n, c) => n + c.matches.length, 0),
    });
  }
  out.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  return out;
}
