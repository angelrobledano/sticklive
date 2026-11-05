import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { clubName } from '@sports/core/names';
import { deviceTimeZone } from '@sports/core/viewer-tz';
import { formatTime } from '@/src/lib/match-helpers';
import { hasWatchLink, rowCenter } from '@/src/lib/match-row';
import type { MatchSummary } from '@sports/core/api';

interface MatchRowProps {
  match: MatchSummary;
  /** Línea pequeña encima con la competición (tarjeta Siguiendo). */
  showCompetition?: boolean;
  /** Texto de esa línea; por defecto el nombre de la competición. */
  caption?: string | null;
  /** Equipos seguidos: su lado lleva estrella. */
  followedTeamIds?: ReadonlySet<string>;
  /** Fecha corta bajo la hora o el resultado (Mi grada). */
  showDate?: boolean;
}

/** «sáb 17» en el idioma y la zona dados, sin puntos ni comas (como la web). */
function shortDay(iso: string | null, locale: string, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', timeZone: tz })
      .format(d).replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** Reloj de 30 s solo para programados (pendiente vs. sin resultado), como useNow30s de la web. */
function useNow30s(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const SUB = 'text-[10px] font-semibold uppercase tracking-wide';

function TeamSide({ id, name, logoUrl, side, followed }: {
  id: string; name: string; logoUrl?: string | null; side: 'home' | 'away'; followed: boolean;
}) {
  const isHome = side === 'home';
  return (
    <View className={`flex-1 flex-row items-center gap-2 ${isHome ? 'pr-2' : 'flex-row-reverse pl-2'}`}>
      <Avatar uri={teamLogoUri(id, 64)} fallbackUri={logoUrl} name={name} size={24} />
      {followed ? <Ionicons name="star" size={11} color={BRAND.granate} /> : null}
      <Text
        className={`flex-1 text-sm font-medium text-slate-800 dark:text-slate-100 ${isHome ? '' : 'text-right'}`}
        numberOfLines={2}
      >
        {name}
      </Text>
    </View>
  );
}

function MatchRowImpl({ match, showCompetition = false, caption, followedTeamIds, showDate = false }: MatchRowProps) {
  const router = useRouter();
  const { t, tv, locale } = useLocale();
  const tz = useMemo(() => deviceTimeZone(), []);

  const now = useNow30s(match.status === 'scheduled');
  const center = rowCenter(match, now);
  const { score } = match;
  const homeName = clubName(match.homeTeam.name) || match.homeTeam.shortName || match.homeTeam.name;
  const awayName = clubName(match.awayTeam.name) || match.awayTeam.shortName || match.awayTeam.name;
  const day = showDate ? shortDay(match.scheduledAt ?? match.startedAt, locale, tz) : '';
  const watch = hasWatchLink(match);
  const topLine = caption !== undefined ? caption : showCompetition ? match.competitionName ?? null : null;

  const scoreText = (cls: string) => (
    <Text className={`font-mono text-base font-extrabold tabular-nums ${cls}`}>
      {score.home ?? 0} – {score.away ?? 0}
    </Text>
  );

  let body: React.ReactNode;
  let text: string;
  if (center.kind === 'live') {
    const state = center.halftime ? t('match_states.half_time') : t('match_states.live');
    text = `${score.home ?? 0}–${score.away ?? 0}, ${state}`;
    const hf = match.fouls?.home ?? null;
    const af = match.fouls?.away ?? null;
    const showFouls = !center.halftime && (hf != null || af != null);
    const bonus = (hf ?? 0) >= 10 || (af ?? 0) >= 10;
    const warning = [9, 14].includes(hf ?? 0) || [9, 14].includes(af ?? 0);
    body = (
      <>
        {scoreText(center.halftime ? 'text-amber-600 dark:text-amber-400' : 'text-live-deep dark:text-live')}
        {center.halftime ? (
          <Text className={`${SUB} text-amber-600 dark:text-amber-400`}>{state}</Text>
        ) : (
          <View className="flex-row items-center gap-1">
            <View className="h-1.5 w-1.5 rounded-full bg-live" />
            <Text className={`${SUB} text-live-deep dark:text-live`}>{state}</Text>
          </View>
        )}
        {/* Extra de la app: faltas en directo con aviso de falta directa */}
        {showFouls ? (
          <View className="flex-row items-center gap-1">
          <Text
            className={`font-mono text-[10px] tabular-nums ${
              bonus ? 'font-extrabold text-rose-600 dark:text-rose-400'
                : warning ? 'font-bold text-amber-600 dark:text-amber-400'
                : 'font-bold text-slate-500 dark:text-slate-400'
            }`}
          >
            F: {hf ?? 0} - {af ?? 0}
          </Text>
          {bonus ? (
            <View className="rounded bg-rose-100 px-1 dark:bg-rose-950/70">
              <Text className="text-[8px] font-black uppercase text-rose-700 dark:text-rose-300">Directa</Text>
            </View>
          ) : null}
          </View>
        ) : null}
      </>
    );
  } else if (center.kind === 'finished') {
    const fin = t(center.finalKey);
    const sub = day ? `${fin} · ${day}` : fin;
    text = `${score.home ?? '-'}–${score.away ?? '-'}, ${sub}${center.penalties ? `, ${t('match_states.penalties_label')} ${center.penalties}` : ''}`;
    body = (
      <>
        {scoreText('text-slate-900 dark:text-slate-50')}
        {center.penalties ? (
          <Text className="text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            {t('match_states.penalties_label')} {center.penalties}
          </Text>
        ) : null}
        <Text className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{sub}</Text>
      </>
    );
  } else if (center.kind === 'postponed' || center.kind === 'cancelled') {
    const state = t(center.kind === 'postponed' ? 'match_states.postponed' : 'match_states.cancelled');
    text = day ? `${state}, ${day}` : state;
    body = (
      <>
        <Text className={`${SUB} text-[11px] ${center.kind === 'postponed' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {state}
        </Text>
        {day ? <Text className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{day}</Text> : null}
      </>
    );
  } else {
    const time = formatTime(match.startedAt ?? match.scheduledAt, tz, locale);
    const sub = day || (center.hint ? t(center.hint) : '');
    text = sub ? `${time}, ${sub}` : time;
    body = (
      <>
        <Text
          className={center.tbd
            ? `${SUB} text-slate-500 dark:text-slate-400`
            : 'font-mono text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200'}
        >
          {time}
        </Text>
        {sub ? <Text className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{sub}</Text> : null}
      </>
    );
  }

  if (watch) text += `, ${t(match.status === 'finished' ? 'match.has_video' : 'match.watch_live')}`;

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${tv('a11y.view_match', { home: homeName, away: awayName })}, ${text}${topLine ? `, ${topLine}` : ''}`}
      className="px-3.5 py-2.5 active:bg-slate-50 dark:active:bg-slate-800/60"
    >
      {topLine ? (
        <Text
          numberOfLines={1}
          className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          {topLine}
        </Text>
      ) : null}

      <View className="min-h-[36px] flex-row items-center">
        <TeamSide id={match.homeTeam.id} name={homeName} logoUrl={match.homeTeam.logoUrl} side="home"
                  followed={!!followedTeamIds?.has(match.homeTeam.id)} />
        <View className="min-w-[64px] items-center justify-center gap-1 px-1">
          {body}
          {watch ? (
            <Ionicons name="tv-outline" size={13} color={match.status === 'live' ? BRAND.granate : '#94a3b8'} />
          ) : null}
        </View>
        <TeamSide id={match.awayTeam.id} name={awayName} logoUrl={match.awayTeam.logoUrl} side="away"
                  followed={!!followedTeamIds?.has(match.awayTeam.id)} />
      </View>
    </Pressable>
  );
}

/** Memoizada: al refrescar el directo solo se repinta la fila que cambia. */
export const MatchRow = memo(MatchRowImpl);
