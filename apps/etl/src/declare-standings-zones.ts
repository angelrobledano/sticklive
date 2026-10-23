/**
 * B2 — Declara las zonas de clasificación de las temporadas cuyo reglamento ya
 * está leído (bases de competición). La fuente sidgad no publica zonas: sin
 * este paso la web cae a la regla genérica (1-8 playoff, 2 últimos descenso),
 * que en la OK Liga 2026/27 es incorrecta (descienden TRES y el 9.º-10.º juega
 * un play-off de colocación que la tabla no explicaba).
 *
 *   node dist/declare-standings-zones.js            # dry-run: qué cambiaría
 *   node dist/declare-standings-zones.js --write    # escribe (idempotente)
 *
 * Añadir una competición = añadir una entrada a CATALOG con su fuente normativa.
 * Nunca se deducen zonas del puesto: solo lo que dicen las bases.
 */
import { fileURLToPath } from 'node:url';
import { db, closeDb, getStandingsZones, replaceStandingsZones } from '@sports/db';
import type { StandingsZone } from '@sports/shared-types';

export interface ZoneDeclaration {
  /** idc sidgad de la competición (competition_sources.external_ids.idc). */
  idc: string;
  season: string;
  label: string;
  sourceNote: string;
  zones: Array<Omit<StandingsZone, 'phaseId' | 'groupName'>>;
}

const BASES_2627 = 'Bases de competición RFEP hockey patines 2026/27';

export const CATALOG: ZoneDeclaration[] = [
  {
    idc: '3568', season: '2026/27', label: 'OK Liga Masculina',
    sourceNote: `${BASES_2627}, §9.1 (pp. 8-9)`,
    zones: [
      { kind: 'final_phase', posFrom: 1, posTo: 8, target: 'Play Off por el título' },
      { kind: 'placement', posFrom: 9, posTo: 10, target: 'Play Off 9.º-10.º (plaza europea)' },
      { kind: 'relegation', posFrom: 12, posTo: 14, target: 'OK Liga Plata' },
    ],
  },
  {
    idc: '3569', season: '2026/27', label: 'OK Liga Iberdrola',
    sourceNote: `${BASES_2627}, §10.1 (p. 12)`,
    zones: [
      { kind: 'final_phase', posFrom: 1, posTo: 4, target: 'Play Off por el título' },
      { kind: 'relegation', posFrom: 12, posTo: 14, target: 'OK Liga Plata Femenina' },
    ],
  },
];

export interface DeclareResult { label: string; seasonId: string | null; changed: boolean }

const same = (a: Omit<StandingsZone, 'phaseId' | 'groupName'>[], b: StandingsZone[]) =>
  a.length === b.length && a.every((z, i) => {
    const o = b[i]!;
    return o.kind === z.kind && o.posFrom === z.posFrom && o.posTo === z.posTo && o.target === z.target && !o.phaseId && !o.groupName;
  });

export async function declareStandingsZones(opts: { write: boolean; catalog?: ZoneDeclaration[] }): Promise<DeclareResult[]> {
  const out: DeclareResult[] = [];
  for (const d of opts.catalog ?? CATALOG) {
    const season = (await db.query<{ id: string }>(
      `SELECT s.id FROM seasons s
         JOIN competition_sources cs ON cs.competition_id = s.competition_id
        WHERE cs.external_ids->>'idc' = $1 AND s.name = $2
        LIMIT 1`, [d.idc, d.season])).rows[0];
    if (!season) {
      console.log(`· ${d.label} ${d.season}: temporada no encontrada (idc ${d.idc}), se omite`);
      out.push({ label: d.label, seasonId: null, changed: false });
      continue;
    }
    const current = await getStandingsZones(season.id);
    const sorted = [...d.zones].sort((a, b) => a.posFrom - b.posFrom);
    const changed = !same(sorted, current);
    console.log(`· ${d.label} ${d.season}: ${changed ? (opts.write ? 'zonas escritas' : 'cambiaría') : 'ya al día'}`
      + ` → ${sorted.map((z) => `${z.posFrom}-${z.posTo} ${z.kind}${z.target ? ` (${z.target})` : ''}`).join(', ')}`);
    if (changed && opts.write) {
      await replaceStandingsZones(season.id, sorted.map((z) => ({ ...z, phaseId: null, groupName: null })), d.sourceNote);
    }
    out.push({ label: d.label, seasonId: season.id, changed });
  }
  return out;
}

const esEjecucionDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esEjecucionDirecta) {
  const write = process.argv.includes('--write');
  declareStandingsZones({ write })
    .then((r) => console.log(`${r.filter((x) => x.changed).length} temporadas ${write ? 'actualizadas' : 'cambiarían (dry-run: repite con --write)'}`))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => closeDb());
}
