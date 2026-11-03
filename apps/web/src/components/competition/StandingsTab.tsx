'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useMemo } from 'react';
import { useT } from '@/lib/i18n';
import type { SeasonStandingRow } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { FavoriteStar } from '@/components/shared/FavoriteStar';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { rowZones, zoneChangesAfter, zoneLegend, type RowZone, type ZoneKind } from '@/lib/standings-zones-view';

/**
 * Estilo por tipo de zona (B2): borde izquierdo + fondo suave + punto de la
 * leyenda. Ascenso en verde, play-off/fase final con el color de marca,
 * descenso en naranja (como antes) y play-out en un naranja más claro.
 */
const ZONE_STYLE: Record<ZoneKind, { row: string; dot: string; cut: string }> = {
  champion:          { row: 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-400/[0.07]', dot: 'bg-amber-500', cut: 'border-b-amber-500/40' },
  promotion:         { row: 'border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-400/[0.06]', dot: 'bg-emerald-500', cut: 'border-b-emerald-500/40' },
  promotion_playoff: { row: 'border-l-rink-passion dark:border-l-rink-accent bg-rink-passion/[0.03] dark:bg-rink-accent/[0.06]', dot: 'bg-rink-passion dark:bg-rink-accent', cut: 'border-b-rink-passion/30 dark:border-b-rink-accent/40' },
  final_phase:       { row: 'border-l-rink-passion dark:border-l-rink-accent bg-rink-passion/[0.03] dark:bg-rink-accent/[0.06]', dot: 'bg-rink-passion dark:bg-rink-accent', cut: 'border-b-rink-passion/30 dark:border-b-rink-accent/40' },
  placement:         { row: 'border-l-slate-400 bg-slate-50/60 dark:bg-slate-400/[0.05]', dot: 'bg-slate-400', cut: 'border-b-slate-400/40' },
  playout:           { row: 'border-l-orange-300 bg-orange-50/30 dark:bg-orange-300/[0.05]', dot: 'bg-orange-300', cut: 'border-b-orange-300/50' },
  relegation:        { row: 'border-l-orange-500 dark:border-l-orange-400 bg-orange-50/40 dark:bg-orange-400/[0.06]', dot: 'bg-orange-500 dark:bg-orange-400', cut: 'border-b-orange-400/50' },
};

// Rejilla compartida por cabecera y filas. En móvil solo caben 3 columnas de
// dato (PT, PJ, DG) para que el nombre del equipo sea legible; desde sm se
// despliegan las 8 completas.
const GRID =
  'grid grid-cols-[20px_minmax(0,1fr)_repeat(3,30px)] ' +
  'sm:grid-cols-[24px_minmax(0,1fr)_repeat(8,26px)] gap-x-1';

// Columnas de estadística en orden. `mobile` marca las 3 que sobreviven en
// pantalla estrecha; el resto se ocultan hasta sm.
const STAT_COLS: { key: string; mobile: boolean }[] = [
  { key: 'pts', mobile: true },
  { key: 'played', mobile: true },
  { key: 'won', mobile: false },
  { key: 'drawn', mobile: false },
  { key: 'lost', mobile: false },
  { key: 'gf', mobile: false },
  { key: 'ga', mobile: false },
  { key: 'gd', mobile: true },
];

export function StandingsTab({ standings }: { standings: SeasonStandingRow[] }) {
  const { t } = useT();

  // Agrupar por group_name. Formatos de liga (OK Liga) no traen grupo → una
  // sola tabla con zonas de playoff/descenso. Formatos con grupos (Europeo:
  // Grupo A/B) → una tabla por grupo, sin zonas (no aplican a grupos de 4).
  const groups = useMemo(() => {
    const map = new Map<string, SeasonStandingRow[]>();
    for (const row of standings) {
      const key = row.groupName ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [standings]);

  if (standings.length === 0) {
    return (
      <div className="card p-8 text-center opacity-60">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('standings.no_data')}</p>
      </div>
    );
  }

  const isGrouped = groups.length > 1 || (groups.length === 1 && groups[0]![0] !== '');

  const tables = isGrouped ? (
    <div className="flex flex-col gap-4">
      {groups.map(([name, rows]) => (
        <div key={name || 'sin-grupo'}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1 mb-1.5">
            {name ? `${t('standings.group')} ${name}` : ''}
          </h3>
          <StandingsTable rows={rows} legacyZones={false} />
        </div>
      ))}
    </div>
  ) : (
    // Zonas: las declaradas en standings_zones (B2). Sin ninguna, el 8/2 de
    // antes solo en ligas de más de 8 equipos (ver standings-zones-view).
    <StandingsTable rows={standings} legacyZones />
  );

  return (
    <div className="flex flex-col gap-3">
      {tables}
      <ColumnsLegend />
    </div>
  );
}

// ── Leyenda de las siglas de columna (clarity) ────────────────────────────────

function ColumnsLegend() {
  const { t } = useT();
  return (
    <details className="card px-4 py-2 group">
      <summary className="flex items-center gap-1.5 cursor-pointer list-none select-none
                          text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="w-3.5 h-3.5 shrink-0 transition-transform group-open:rotate-90">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('standings.legend_title')}
      </summary>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2.5 pb-1">
        {STAT_COLS.map(({ key }) => (
          <div key={key} className="flex items-baseline gap-2">
            <dt className="w-7 shrink-0 text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200">
              {t(`standings.cols.${key}`)}
            </dt>
            <dd className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              {t(`standings.cols_full.${key}`)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

// ── Tabla individual (un grupo o la liga completa) ────────────────────────────

function zoneLabel(t: (k: string, v?: Record<string, string | number>) => string, z: RowZone): string {
  const zone = t(`standings.zones.${z.kind}`);
  return z.target ? t('standings.zones.to', { zone, target: z.target }) : zone;
}

function StandingsTable({
  rows,
  legacyZones,
}: {
  rows: SeasonStandingRow[];
  legacyZones: boolean;
}) {
  const { t } = useT();
  const zones = rowZones(rows, { legacyFallback: legacyZones });
  const cuts = zoneChangesAfter(zones);
  const legend = zoneLegend(zones);

  return (
    <div className="card overflow-hidden">
      {/* #356: semántica de tabla real (roles ARIA) para que un lector de
          pantalla asocie cada valor con su cabecera; el grid visual no cambia. */}
      <div role="table" aria-label={t('match_tabs.standing')}>
      <div role="row" className={`${GRID} px-3 py-1.5 border-l-2 border-l-transparent
                      bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800`}>
        <span role="columnheader" className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center">#</span>
        <span role="columnheader" className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{t('standings.team')}</span>
        {STAT_COLS.map(({ key, mobile }) => (
          <span
            key={key}
            role="columnheader"
            className={`text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center ${mobile ? '' : 'hidden sm:block'}`}
          >
            {t(`standings.cols.${key}`)}
          </span>
        ))}
      </div>

      <div role="rowgroup" className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {rows.map((row, idx) => {
          const pos = row.position ?? idx + 1;
          const zone = zones[idx] ?? null;
          const style = zone ? ZONE_STYLE[zone.kind] : null;
          // Línea de corte con el color de la zona que termina (o de la que empieza).
          const cutStyle = cuts[idx] ? (style ?? (zones[idx + 1] ? ZONE_STYLE[zones[idx + 1]!.kind] : null)) : null;

          // Celdas centrales en orden: PJ (móvil) + PG/PE/PP/GF/GC (desde sm).
          const midCells: { key: string; value: number; mobile: boolean }[] = [
            { key: 'played', value: row.played, mobile: true },
            { key: 'won', value: row.won, mobile: false },
            { key: 'drawn', value: row.drawn, mobile: false },
            { key: 'lost', value: row.lost, mobile: false },
            { key: 'gf', value: row.goalsFor, mobile: false },
            { key: 'ga', value: row.goalsAgainst, mobile: false },
          ];

          return (
            <div
              key={row.id}
              role="row"
              className={`${GRID} px-3 py-2 items-center border-l-2
                ${cutStyle ? `border-b-2 border-dashed ${cutStyle.cut}` : ''}
                ${style ? style.row : 'border-l-transparent'}
              `}
            >
              <span role="cell" className="text-xs font-semibold text-center tabular-nums text-slate-500 dark:text-slate-400"
                    {...(zone ? { title: zoneLabel(t, zone) } : {})}>
                {pos}
                {zone && <span className="sr-only">, {zoneLabel(t, zone)}</span>}
              </span>

              {/* Estrella FUERA del Link: un <button> dentro de un <a> es HTML
                  inválido y confunde a los lectores de pantalla (#364). */}
              <div role="cell" className="flex items-center gap-2 min-w-0">
                <Link
                  href={`/teams/${row.teamId}`}
                  className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
                >
                  <TeamShield teamId={row.teamId} teamName={row.teamName} size={20} />
                  <AdaptiveTeamName
                    name={row.teamName}
                    shortName={row.teamShortName}
                    className="flex-1 min-w-0 text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
                  />
                </Link>
                <FavoriteStar
                  id={row.teamId}
                  kind="team"
                  name={row.teamShortName ?? row.teamName}
                  className="shrink-0 !w-10 !h-10 !-m-2.5"
                />
              </div>

              {/* PT */}
              <div role="cell" className="flex items-baseline justify-center gap-0.5">
                <span className="text-xs font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {row.points}
                </span>
                {row.penalizationPoints < 0 && (
                  <span className="text-[11px] font-bold text-red-600 dark:text-red-400 tabular-nums leading-none">
                    {row.penalizationPoints}
                  </span>
                )}
              </div>

              {/* PJ + PG/PE/PP/GF/GC */}
              {midCells.map(({ key, value, mobile }) => (
                <span
                  key={key}
                  role="cell"
                  className={`text-[11px] text-slate-500 dark:text-slate-400 text-center tabular-nums ${mobile ? '' : 'hidden sm:block'}`}
                >
                  {value}
                </span>
              ))}

              {/* DG */}
              <span role="cell" className={`text-xs font-semibold text-center tabular-nums ${
                row.goalDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                row.goalDiff < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
              }`}>
                {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
              </span>
            </div>
          );
        })}
      </div>
      </div>

      {legend.length > 0 && (
        <ul className="px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-100 dark:border-slate-800">
          {legend.map((z) => (
            <li key={`${z.kind}|${z.target ?? ''}`} className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ZONE_STYLE[z.kind].dot}`} aria-hidden="true" />
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {/* Sin zonas declaradas se conservan los textos de antes ("Playoffs (1º–8º)"). */}
                {z.kind === 'promotion_playoff' && !z.target && !rows.some((r) => r.zone)
                  ? t('standings.playoffs_zone')
                  : z.kind === 'relegation' && !z.target && !rows.some((r) => r.zone)
                    ? t('standings.relegation_zone')
                    : zoneLabel(t, z)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
