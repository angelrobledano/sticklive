import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { PenaltyShootout } from '@/src/components/match/PenaltyShootout';
import { GoalStickIcon } from '@/src/components/shared/GoalStickIcon';
import { clubName } from '@/src/lib/names';
import { deviceTimeZone, localTimeDiffers } from '@/src/lib/viewer-tz';
import {
  eventSurname,
  finalLabelKey,
  fmtEventClock,
  formatDate,
  formatTime,
  penaltyText,
} from '@/src/lib/match-helpers';
import type { MatchDetail } from '@/src/lib/api/types';

interface MatchHeaderProps {
  data: MatchDetail;
  liveStale?: boolean;
  staleSeconds?: number;
  connected?: boolean;
  transport?: 'sse' | 'poll';
  onReconnect?: () => void;
}

export function MatchHeader({
  data,
  liveStale = false,
  staleSeconds = 0,
  connected = true,
  transport = 'sse',
  onReconnect,
}: MatchHeaderProps) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { match, stats, events } = data;
  const ht = match.homeTeam;
  const at = match.awayTeam;

  const homeName = clubName(ht.name) || ht.shortName || ht.name;
  const awayName = clubName(at.name) || at.shortName || at.name;

  const isLive =
    match.status === 'live' ||
    match.status === 'halftime' ||
    match.status === 'overtime' ||
    match.status === 'penalty_shootout';
  const isFinished = match.status === 'finished';
  const showScore = isLive || isFinished;

  const viewerTz = deviceTimeZone();
  const differs = localTimeDiffers(match.scheduledAt, viewerTz, match.competitionTimezone);
  const localTimeStr =
    differs && match.competitionTimezone
      ? formatTime(match.scheduledAt, match.competitionTimezone, locale)
      : null;
  const localTimeNotice = localTimeStr
    ? t('match_detail.local_time') !== 'match_detail.local_time'
      ? t('match_detail.local_time').replace('{time}', localTimeStr)
      : `${localTimeStr} hora local`
    : null;

  // Crono en vivo descendente local: solo corre si la conexión está viva (evita tiempo fantasma en pabellón)
  const live = match.live;
  const isClockRunning = Boolean(
    live && !live.isHalftime && live.clockSeconds != null && live.clockAt && connected
  );
  const [remaining, setRemaining] = useState<number | null>(null);

  const clockSeconds = live?.clockSeconds;
  const clockAt = live?.clockAt;

  useEffect(() => {
    if (!isClockRunning || clockSeconds == null || !clockAt) return;
    const base = clockSeconds;
    const anchor = new Date(clockAt).getTime();
    const tick = () => {
      const r = base - (Date.now() - anchor) / 1000;
      setRemaining(Math.max(0, Math.min(1500, Math.round(r))));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isClockRunning, clockSeconds, clockAt]);

  const effectiveRemaining = isClockRunning && remaining != null ? remaining : live?.clockSeconds;
  const mmss =
    effectiveRemaining != null
      ? `${String(Math.floor(effectiveRemaining / 60)).padStart(2, '0')}:${String(effectiveRemaining % 60).padStart(2, '0')}`
      : null;

  const periodLabel =
    live?.period === 2
      ? t('match_states.second_half')
      : live?.period === 1
        ? t('match_states.first_half')
        : null;

  // Goles y tarjetas para el resumen rápido bajo el marcador
  const keyEvents = (events ?? []).filter(
    (e) => (e.eventType === 'goal' || e.eventType === 'blue_card' || e.eventType === 'red_card') && e.player
  );

  return (
    <View className="mx-3 mt-2 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
      {/* Competición */}
      {match.competitionName ? (
        <View className="items-center pb-2">
          {match.competitionId ? (
            <Pressable
              onPress={() => router.push(`/competition/${match.competitionId}`)}
              className="flex-row items-center gap-1 active:opacity-70"
            >
              <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                {match.competitionName}
              </Text>
              <Ionicons name="chevron-forward" size={12} color="#94a3b8" />
            </Pressable>
          ) : (
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
              {match.competitionName}
            </Text>
          )}
        </View>
      ) : null}

      {/* Estado del partido */}
      <View className="items-center min-h-[22px] justify-center mb-3">
        {isLive ? (
          <View className="items-center gap-1.5">
            <View className="flex-row items-center gap-2">
              {live?.isHalftime ? (
                <View className="flex-row items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5">
                  <View className="h-2 w-2 rounded-full bg-amber-500" />
                  <Text className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    {t('match_states.half_time')}
                  </Text>
                </View>
              ) : (
                <View className="flex-row items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 dark:bg-emerald-950/40">
                  <View className="h-2 w-2 rounded-full bg-emerald-500" />
                  <Text className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    {t('match_states.live')}
                  </Text>
                  {periodLabel ? (
                    <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      · {periodLabel} {mmss ? `· ${mmss}` : ''}
                    </Text>
                  ) : null}
                </View>
              )}
              {liveStale && connected ? (
                <Text className="text-[10px] text-amber-600 dark:text-amber-400">
                  · {t('match_detail.freshness_stale').replace('{s}', String(staleSeconds))}
                </Text>
              ) : null}
            </View>

            {/* Aviso visible de desconexión en pabellón con botón de reintento manual */}
            {!connected ? (
              <Pressable
                onPress={onReconnect}
                className="flex-row items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel={`${t('match_detail.freshness_down').split('·')[0]?.trim() ?? 'Sin señal'} - ${t('errors.retry')}`}
              >
                <View className="h-2 w-2 rounded-full bg-amber-500" />
                <Text className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {t('match_detail.freshness_down').split('·')[0]?.trim() ?? 'Sin señal'}
                </Text>
                {onReconnect ? (
                  <Text className="text-xs font-bold text-amber-800 underline dark:text-amber-200">
                    · {t('errors.retry')}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        ) : isFinished ? (
          <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-300">
            {t(finalLabelKey(match.winType))}
          </Text>
        ) : (
          <Text className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {formatDate(match.scheduledAt, viewerTz, locale)} ·{' '}
            {formatTime(match.scheduledAt, viewerTz, locale)}
            {localTimeNotice ? ` (${localTimeNotice})` : ''}
          </Text>
        )}
      </View>

      {/* Marcador central y escudos */}
      <View className="flex-row items-center justify-between py-2">
        {/* Local */}
        <View className="flex-1 items-center px-1">
          <Pressable
            onPress={() => router.push(`/team/${ht.id}`)}
            className="items-center active:opacity-75"
          >
            <Avatar
              uri={teamLogoUri(ht.id, 96)}
              fallbackUri={ht.logoUrl}
              name={ht.name}
              size={54}
            />
            <Text
              className="mt-2 text-center text-sm font-bold text-slate-900 dark:text-slate-100"
              numberOfLines={2}
            >
              {homeName}
            </Text>
          </Pressable>
          <View className="mt-0.5">
            <FollowButton kind="team" refId={ht.id} name={homeName} />
          </View>
        </View>

        {/* Marcador */}
        <View className="items-center px-3 min-w-[110px]">
          {showScore ? (
            <View className="flex-row items-center">
              <Text className="font-mono text-4xl font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                {match.score.home ?? 0}
              </Text>
              <Text className="mx-2 text-3xl font-light text-slate-300 dark:text-slate-400">:</Text>
              <Text className="font-mono text-4xl font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                {match.score.away ?? 0}
              </Text>
            </View>
          ) : (
            <View className="items-center rounded-xl bg-slate-100 px-3 py-1.5 dark:bg-slate-800">
              <Text className="font-mono text-xl font-bold text-slate-700 dark:text-slate-300">
                {formatTime(match.scheduledAt, viewerTz, locale)}
              </Text>
              {localTimeNotice ? (
                <Text className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {localTimeNotice}
                </Text>
              ) : null}
            </View>
          )}

          {isFinished && penaltyText(match.penalties) ? (
            <Text className="mt-1 text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
              {t('match_states.penalties_label')} {penaltyText(match.penalties)}
            </Text>
          ) : null}

          {isFinished && match.winnerTeamId && match.winType !== 'regular' ? (
            <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('match_states.winner')}:{' '}
              <Text className="font-bold text-slate-800 dark:text-slate-200">
                {match.winnerTeamId === ht.id ? homeName : awayName}
              </Text>
            </Text>
          ) : null}
        </View>

        {/* Visitante */}
        <View className="flex-1 items-center px-1">
          <Pressable
            onPress={() => router.push(`/team/${at.id}`)}
            className="items-center active:opacity-75"
          >
            <Avatar
              uri={teamLogoUri(at.id, 96)}
              fallbackUri={at.logoUrl}
              name={at.name}
              size={54}
            />
            <Text
              className="mt-2 text-center text-sm font-bold text-slate-900 dark:text-slate-100"
              numberOfLines={2}
            >
              {awayName}
            </Text>
          </Pressable>
          <View className="mt-0.5">
            <FollowButton kind="team" refId={at.id} name={awayName} />
          </View>
        </View>
      </View>

      {/* Resumen rápido de goles y tarjetas */}
      {showScore && keyEvents.length > 0 ? (
        <View className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800/80">
          <View className="flex-row">
            {/* Columna Local */}
            <View className="flex-1 items-end pr-3">
              {keyEvents
                .filter((e) => e.isHomeTeam)
                .map((e) => (
                  <View key={e.id} className="flex-row items-center gap-1 my-0.5">
                    <Text className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {eventSurname(e.player!)}
                    </Text>
                    <Text className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {fmtEventClock(e)}
                    </Text>
                    {e.eventType === 'goal' ? (
                      <GoalStickIcon variant="inline" size={13} />
                    ) : (
                      <View
                        className={`h-2.5 w-1.5 rounded-sm ${e.eventType === 'blue_card' ? 'bg-blue-500' : 'bg-red-500'}`}
                      />
                    )}
                  </View>
                ))}
            </View>

            {/* Separador vertical */}
            <View className="w-px bg-slate-200 dark:bg-slate-700" />

            {/* Columna Visitante */}
            <View className="flex-1 items-start pl-3">
              {keyEvents
                .filter((e) => !e.isHomeTeam)
                .map((e) => (
                  <View key={e.id} className="flex-row items-center gap-1 my-0.5">
                    {e.eventType === 'goal' ? (
                      <GoalStickIcon variant="inline" size={13} />
                    ) : (
                      <View
                        className={`h-2.5 w-1.5 rounded-sm ${e.eventType === 'blue_card' ? 'bg-blue-500' : 'bg-red-500'}`}
                      />
                    )}
                    <Text className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {eventSurname(e.player!)}
                    </Text>
                    <Text className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {fmtEventClock(e)}
                    </Text>
                  </View>
                ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* Tanda de penaltis lanzador a lanzador */}
      {isFinished &&
      match.penaltyShootout &&
      (match.penaltyShootout.home.length > 0 || match.penaltyShootout.away.length > 0) ? (
        <PenaltyShootout
          shootout={match.penaltyShootout}
          homeName={homeName}
          awayName={awayName}
        />
      ) : null}

      {/* Faltas de equipo */}
      {stats && (stats.homeFouls > 0 || stats.awayFouls > 0) ? (
        <View className="mt-3 flex-row items-center justify-between border-t border-slate-100 px-2 pt-2.5 dark:border-slate-800">
          <View className="flex-row items-baseline gap-1">
            <Text className="font-mono text-base font-extrabold text-slate-800 dark:text-slate-200">
              {stats.homeFouls}
            </Text>
            <Text className="text-xs text-slate-500 dark:text-slate-400">{t('match_detail.fouls')}</Text>
          </View>
          <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
            {t('match_detail.team_fouls_header')}
          </Text>
          <View className="flex-row items-baseline gap-1">
            <Text className="text-xs text-slate-500 dark:text-slate-400">{t('match_detail.fouls')}</Text>
            <Text className="font-mono text-base font-extrabold text-slate-800 dark:text-slate-200">
              {stats.awayFouls}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Pabellón y Árbitro */}
      {match.venue || match.referee ? (
        <View className="mt-3 flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 dark:border-slate-800">
          {match.venue ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="location-outline" size={13} color="#64748b" />
              <Text className="text-xs text-slate-500 dark:text-slate-400">
                {match.venue.name}
                {match.venue.city ? ` · ${match.venue.city}` : ''}
              </Text>
            </View>
          ) : null}
          {match.referee ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="flag-outline" size={13} color="#64748b" />
              <Text className="text-xs text-slate-500 dark:text-slate-400">
                {t('match_detail.referee_short')} {match.referee}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Enlace de vídeo */}
      {match.videoUrl ? (
        <View className="mt-3 items-center pt-1">
          <Pressable
            onPress={() => void Linking.openURL(match.videoUrl!)}
            className="flex-row items-center gap-2 rounded-full px-4 py-2 active:opacity-80"
            style={{ backgroundColor: BRAND.granate }}
            accessibilityRole="button"
            accessibilityLabel={
              isLive
                ? t('match_detail.watch_live') !== 'match_detail.watch_live'
                  ? t('match_detail.watch_live')
                  : 'Ver en directo'
                : t('match_detail.watch_video') !== 'match_detail.watch_video'
                  ? t('match_detail.watch_video')
                  : 'Ver vídeo'
            }
          >
            <Ionicons name="play" size={14} color="#ffffff" />
            <Text className="text-xs font-bold text-white">
              {isLive
                ? t('match_detail.watch_live') !== 'match_detail.watch_live'
                  ? t('match_detail.watch_live')
                  : 'Ver en directo'
                : t('match_detail.watch_video') !== 'match_detail.watch_video'
                  ? t('match_detail.watch_video')
                  : 'Ver vídeo'}
              {videoHost(match.videoUrl) ? (
                <Text className="font-normal opacity-80"> · {videoHost(match.videoUrl)}</Text>
              ) : null}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Dominio legible del enlace de vídeo ("okliga.tv", "youtube.com"), o null. */
function videoHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const match = /^(?:https?:\/\/)?(?:www\.)?([^/]+)/i.exec(url);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
