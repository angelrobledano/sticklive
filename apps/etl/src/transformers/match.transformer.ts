import { z } from 'zod';
import type { ScrapedMatch, MatchStatus } from '@sports/shared-types';
import type { UpsertMatchInput } from '@sports/db';

/**
 * Mapa de strings de estado que pueden venir de la fuente → MatchStatus canónico.
 * Ampliar según lo que devuelva sidgad.com una vez se identifique su API.
 */
const STATUS_MAP: Record<string, MatchStatus> = {
  // Español
  programado: 'scheduled',
  pendiente: 'scheduled',
  'por jugar': 'scheduled',
  'en juego': 'live',
  directo: 'live',
  live: 'live',
  jugando: 'live',
  finalizado: 'finished',
  terminado: 'finished',
  jugado: 'finished',
  aplazado: 'postponed',
  cancelado: 'cancelled',
  suspendido: 'cancelled',
  // Inglés (por si sidgad devuelve en inglés)
  scheduled: 'scheduled',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function normalizeStatus(raw: string | undefined): MatchStatus {
  if (!raw) return 'scheduled';
  return STATUS_MAP[raw.toLowerCase().trim()] ?? 'scheduled';
}

/**
 * ¿La etiqueta de la fuente es una de las que sabemos mapear? #377(P3-13): un
 * cambio de etiquetas aguas arriba caía en `scheduled` en silencio. No podemos
 * adivinar el estado correcto de una etiqueta desconocida, pero sí hacer ruido.
 */
export function isKnownStatus(raw: string | undefined): boolean {
  if (!raw) return false;
  return raw.toLowerCase().trim() in STATUS_MAP;
}

const ScrapedMatchSchema = z.object({
  seasonId: z.string(),
  roundId: z.string().optional(),
  homeTeamRef: z.string().min(1),
  awayTeamRef: z.string().min(1),
  homeScore: z.number().int().min(0).optional(),
  awayScore: z.number().int().min(0).optional(),
  status: z.string().optional(),
  scheduledAt: z.string().optional(),
  venueName: z.string().optional(),
  venueCity: z.string().optional(),
  videoUrl: z.string().optional(),
  sourceId: z.string(),
  sourceRef: z.string().optional(),
  sourceUrl: z.url().optional(),
  scrapedAt: z.date(),
});

export interface MatchTransformResult {
  homeTeamRef: string;
  awayTeamRef: string;
  input: Omit<UpsertMatchInput, 'homeTeamId' | 'awayTeamId'> & {
    sourceRef: string;
  };
  warnings: string[];
}

/**
 * Transforma datos crudos de partido.
 *
 * NOTA IMPORTANTE sobre teamRef → teamId:
 * El transformer NO resuelve los IDs de equipo — eso lo hace el Loader,
 * que tiene acceso a la DB. El transformer solo normaliza los datos.
 * El resultado incluye homeTeamRef/awayTeamRef para que el Loader los resuelva.
 */
export function transformMatch(raw: ScrapedMatch): MatchTransformResult {
  const warnings: string[] = [];

  const parsed = ScrapedMatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Dato de partido inválido: ${parsed.error.message}`);
  }

  const data = parsed.data;

  // source_ref: si no hay uno de la fuente, generar uno sintético.
  // Estrategia: season + homeRef + awayRef + fecha. Menos robusto que un ID real.
  const sourceRef =
    data.sourceRef ??
    `synthetic:${data.seasonId}:${data.homeTeamRef}:${data.awayTeamRef}:${data.scheduledAt ?? 'nodate'}`;

  if (!data.sourceRef) {
    warnings.push(
      `Partido sin source_ref de la fuente — usando ref sintética: ${sourceRef}. ` +
      `Si el partido se reprograma puede generar duplicado. Verificar con la fuente.`
    );
  }

  let scheduledAt: Date | undefined;
  if (data.scheduledAt) {
    const parsed = new Date(data.scheduledAt);
    if (isNaN(parsed.getTime())) {
      warnings.push(`Fecha de partido inválida: "${data.scheduledAt}" — ignorando`);
    } else {
      scheduledAt = parsed;
    }
  }

  const status = normalizeStatus(data.status);
  if (data.status && !isKnownStatus(data.status)) {
    warnings.push(
      `Estado desconocido de la fuente: "${data.status}" — interpretado como 'scheduled'. ` +
      `Revisar el mapeo de STATUS_MAP (posible cambio de etiquetas de la fuente).`
    );
  }

  return {
    homeTeamRef: data.homeTeamRef,
    awayTeamRef: data.awayTeamRef,
    input: {
      seasonId: data.seasonId,
      roundId: data.roundId,
      homeScore: data.homeScore,
      awayScore: data.awayScore,
      status,
      scheduledAt,
      venueName: data.venueName,
      venueCity: data.venueCity,
      videoUrl: data.videoUrl,
      sourceId: data.sourceId,
      sourceRef,
      sourceUrl: data.sourceUrl,
      scrapedAt: data.scrapedAt,
    },
    warnings,
  };
}
