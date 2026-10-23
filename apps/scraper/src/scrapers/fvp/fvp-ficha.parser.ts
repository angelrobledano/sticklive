/**
 * Acta de un partido de la API vasca (`/public/partidos/{id}`) → alineación y
 * eventos en el formato del acta FEP (mismo loader que FEP y FPP).
 *
 * Identidad del jugador: el id de su ficha federativa, que viene en la foto
 * (`/affiliations/{uuid}.webp`). Si no hay foto se usa `plantillaEquipoId`
 * (su fila en la plantilla de ESE equipo). Los eventos se vinculan por
 * `plantillaEquipoId`, nunca por nombre.
 *
 * Crono: `minuto:segundo` es el tiempo RESTANTE de la parte, como en la FEP.
 *
 * Penalti y falta directa: el evento lleva el equipo que COMETE la falta (y su
 * portero). En Stick Live el lanzamiento es del equipo que tira, así que se
 * invierte el lado. El gol, si entra, viene como un GOL aparte.
 *
 * Deporte escolar: con `marcadorACero` la federación publica el partido 0-0 a
 * propósito (benjamines, sin marcador). El acta registra los goles igualmente,
 * pero NO se cargan: sería publicar un marcador que la federación oculta. Con
 * `maxDiferenciaGoles` el resultado oficial se corta (3-11 → 3-8) y los goles
 * del acta se cargan tal cual (el partido queda con cobertura parcial).
 */
import type { UpsertMatchLineupInput } from '@sports/db';
import {
  eventSourceRef, disambiguateEventRefs, remainingToElapsedMinute,
  type ScrapedMatchEvent, type FepEventType,
} from '../fep/fep-ficha.parser.js';
import { FVP_EVENT_PREFIX, FVP_PLAYER_PREFIX } from './fvp-catalog.js';

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export interface FvpLineupEntry {
  isHome: boolean;
  jerseyNumber: number | null;
  name: string;
  firstName: string | null;
  plantillaId: string;
  playerRef: string | null;
  photoUrl: string | null;
  isStarter: boolean;
  isCaptain: boolean;
  isGoalkeeper: boolean;
  role: string | null;
}

export interface FvpActa {
  estado: string;
  actaEstado: string | null;
  homeTeamApiId: string | null;
  awayTeamApiId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeFouls: number;
  awayFouls: number;
  referees: string | null;
  lineup: FvpLineupEntry[];
  events: ScrapedMatchEvent[];
  /** Tipos de incidencia que no traducimos (para vigilar cambios de la fuente). */
  unknownTypes: string[];
  /** La federación oculta el marcador (deporte escolar): sin goles ni penaltis/faltas directas. */
  hiddenScore: boolean;
}

const STAFF: Record<string, string> = { ENTRENADOR: 'E1', SEGUNDO_ENTRENADOR: 'E2', ENTRENADOR_AYUDANTE: 'E2', DELEGADO: 'D' };
const PLAYER_ROLES = new Set(['JUGADOR', 'PORTERO']);
/** Incidencias que no son eventos de Stick Live (estadística de juego). */
const IGNORED = new Set(['CAMBIO', 'PARADA', 'TIRO', 'TARJETAAMARILLA', 'ASISTENCIA', 'INICIO', 'FIN', 'INICIOPERIODO', 'FINPERIODO']);

/** `/affiliations/6b79…webp` → `6b79…`. */
export function affiliationIdOf(url: string | null): string | null {
  return /\/affiliations\/([0-9a-f-]{36})\.[a-z]+/i.exec(url ?? '')?.[1] ?? null;
}

function lineupOf(list: unknown, isHome: boolean): FvpLineupEntry[] {
  if (!Array.isArray(list)) return [];
  return (list as Json[]).flatMap((a) => {
    const plantillaId = str(a['plantillaEquipoId']);
    const name = str(a['nombre']);
    if (!plantillaId || !name) return [];
    const rol = (str(a['rolPosicion']) ?? 'JUGADOR').toUpperCase();
    const isPlayer = PLAYER_ROLES.has(rol);
    const photo = str(a['fotoUrl']);
    const aff = affiliationIdOf(photo);
    const dorsal = Number.parseInt(str(a['dorsal']) ?? '', 10);
    return [{
      isHome,
      jerseyNumber: Number.isFinite(dorsal) ? dorsal : null,
      name,
      firstName: str(a['nombrePila']),
      plantillaId,
      playerRef: isPlayer ? `${FVP_PLAYER_PREFIX}${aff ?? `pe_${plantillaId}`}` : null,
      photoUrl: photo,
      isStarter: a['esInicial'] === true,
      isCaptain: a['esCapitan'] === true,
      isGoalkeeper: rol === 'PORTERO',
      role: isPlayer ? null : (STAFF[rol] ?? 'A'),
    }];
  });
}

function clockOf(min: unknown, sec: unknown): string | undefined {
  if (typeof min !== 'number' || typeof sec !== 'number') return undefined;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function parseFvpActa(raw: unknown, matchKey: string): FvpActa {
  if (!raw || typeof raw !== 'object') throw new Error('FVP: acta vacía');
  const p = raw as Json;
  const local = (p['local'] ?? {}) as Json;
  const visit = (p['visitante'] ?? {}) as Json;
  const homeId = str(local['equipoId']);
  const awayId = str(visit['equipoId']);
  const lineup = [...lineupOf(p['alineacionesLocal'], true), ...lineupOf(p['alineacionesVisitante'], false)];
  const byPlantilla = new Map(lineup.map((l) => [l.plantillaId, l]));

  if (!Array.isArray(p['incidencias'])) throw new Error(`FVP: acta ${matchKey} sin lista de incidencias`);
  const incid = p['incidencias'] as Json[];
  // Orden cronológico: parte ↑ y crono restante ↓ (desempate por hora de registro).
  const secs = (i: Json) => (Number(i['minuto']) || 0) * 60 + (Number(i['segundo']) || 0);
  const chrono = [...incid].sort((a, b) =>
    (Number(a['periodo']) || 0) - (Number(b['periodo']) || 0) || secs(b) - secs(a)
    || String(a['fechaCreacion'] ?? '').localeCompare(String(b['fechaCreacion'] ?? '')));

  const hiddenScore = p['marcadorACero'] === true;
  const unknown = new Set<string>();
  const events: ScrapedMatchEvent[] = [];
  let h = 0, a = 0, fh = 0, fa = 0, order = 0;
  for (const i of chrono) {
    const tipo = (str(i['tipo']) ?? '').toUpperCase();
    if (IGNORED.has(tipo)) continue;
    if (hiddenScore && ['GOL', 'AUTOGOL', 'PENALTI', 'FALTADIRECTA'].includes(tipo)) continue;
    const team = str(i['equipoId']);
    const side: boolean | null = team === homeId ? true : team === awayId ? false : null;
    const period = typeof i['periodo'] === 'number' ? i['periodo'] : undefined;
    const clock = clockOf(i['minuto'], i['segundo']);
    const minute = clock ? remainingToElapsedMinute(clock, period) ?? null : null;
    const who = byPlantilla.get(str(i['plantillaEquipoId']) ?? '');

    let mapped: Array<{ type: FepEventType; detail: string | null; isHome: boolean | null; player: boolean }>;
    switch (tipo) {
      case 'GOL': {
        if (side === true) h++; else if (side === false) a++;
        mapped = [{ type: 'goal', detail: `${h}-${a}`, isHome: side, player: true }];
        break;
      }
      case 'AUTOGOL': {
        if (side === true) h++; else if (side === false) a++;
        mapped = [{ type: 'goal', detail: `${h}-${a} (autogolo)`, isHome: side, player: false }];
        break;
      }
      case 'PENALTI': case 'FALTADIRECTA': {
        const scored = (str(i['resultado']) ?? '').toUpperCase() === 'GOL';
        const shooter = side === null ? null : !side;
        mapped = [{
          type: tipo === 'PENALTI' ? 'penalty' : 'direct_foul',
          detail: tipo === 'PENALTI' ? (scored ? 'marcado' : 'fallado') : (scored ? 'marcada' : 'fallada'),
          isHome: shooter, player: false,
        }];
        break;
      }
      case 'TARJETAAZUL': mapped = [{ type: 'blue_card', detail: null, isHome: side, player: true }]; break;
      case 'TARJETAROJA': mapped = [{ type: 'red_card', detail: null, isHome: side, player: true }]; break;
      case 'TM': mapped = [{ type: 'timeout', detail: null, isHome: side, player: false }]; break;
      case 'FALTA': {
        const n = side === true ? ++fh : side === false ? ++fa : null;
        mapped = [{ type: 'foul', detail: n !== null ? String(n) : null, isHome: side, player: false }];
        break;
      }
      default:
        unknown.add(tipo);
        continue;
    }

    for (const m of mapped) {
      const isPlayer = m.player && !!who?.playerRef;
      events.push({
        eventType: m.type,
        minute,
        period: period ?? null,
        ...(clock ? { clock } : {}),
        isHome: m.isHome,
        playerName: m.player ? (who?.name ?? str(i['nombre'])) : null,
        jerseyNumber: m.player ? (who?.jerseyNumber ?? null) : null,
        detail: m.detail,
        sourceRef: eventSourceRef({
          idp: matchKey, period, clock, eventType: m.type, isHome: m.isHome,
          fallbackIdx: order, minute, prefix: FVP_EVENT_PREFIX,
        }),
        ...(isPlayer ? { playerSourceRef: who!.playerRef! } : {}),
      });
      order++;
    }
  }
  disambiguateEventRefs(events);

  const refs = [str(p['arbitro1Nombre']), str(p['arbitro2Nombre'])].filter(Boolean);
  const score = (o: Json) => (typeof o['puntaje'] === 'number' ? o['puntaje'] : null);
  return {
    estado: str(p['estado']) ?? '',
    actaEstado: str(p['actaEstado']),
    homeTeamApiId: homeId,
    awayTeamApiId: awayId,
    homeScore: score(local),
    awayScore: score(visit),
    homeFouls: fh,
    awayFouls: fa,
    referees: refs.length ? refs.join(' / ') : null,
    lineup,
    events,
    unknownTypes: [...unknown],
    hiddenScore,
  };
}

export function lineupToInput(l: FvpLineupEntry, playerId: string | undefined): UpsertMatchLineupInput {
  return {
    isHome: l.isHome,
    ...(l.jerseyNumber !== null ? { jerseyNumber: l.jerseyNumber } : {}),
    playerName: l.name,
    ...(l.firstName ? { playerFirstName: l.firstName } : {}),
    isStarter: l.isStarter,
    isCaptain: l.isCaptain,
    isGoalkeeper: l.isGoalkeeper,
    ...(l.role ? { role: l.role } : {}),
    ...(!l.role && l.playerRef ? { playerSourceRef: l.playerRef, playerId } : {}),
    scrapedAt: new Date(),
  };
}
