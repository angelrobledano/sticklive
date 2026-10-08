import { useEffect, useMemo } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useAdsConfig, useCurrentMatches } from '@/src/hooks/queries';
import { MatchCard } from '@/src/components/match/MatchCard';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { NativeFeedAd } from '@/src/components/ads/NativeFeedAd';
import { insertNativeAdPositions } from '@/src/lib/ads/nativeFeed';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { BrandLoader } from '@/src/components/shared/BrandLoader';
import { capture } from '@/src/lib/analytics';
import { formatDayKey, formatDayLabel, isEffectivelyLive } from '@/src/lib/time';
import type { MatchSummary } from '@/src/lib/api/types';

interface Section {
  key: string;
  title: string;
  matches: MatchSummary[];
}

/**
 * Items de la FlatList (Plan D Task 6): la lista se aplana a nivel de
 * partido para poder intercalar el native in-feed "cada N items de datos"
 * (un punto de inserción v1, calculado con insertNativeAdPositions) — con
 * secciones como celdas, el anuncio no podría caer en mitad de un día.
 */
type FeedItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'match'; key: string; match: MatchSummary }
  | { kind: 'ad'; key: string };

export default function LiveScreen() {
  const { data, isPending, isError, refetch, isRefetching } = useCurrentMatches();
  const { data: adsConfig } = useAdsConfig();
  const { t } = useLocale();

  // Analítica (Task 5.1): vista de la pestaña "En directo" (la home de la app).
  useEffect(() => {
    capture('live_tab_viewed');
  }, []);

  const sections = useMemo<Section[]>(() => {
    const list = data ?? [];
    const live = list.filter((m) => isEffectivelyLive(m.status, m.scheduledAt));
    // Clave de sección = fecha ISO (formatDayKey, Task 5.2): estable y sin
    // colisiones con '__live__' ni con etiquetas localizadas. La etiqueta
    // humanizada va aparte (todos los partidos del bucket comparten día).
    const byDay = new Map<string, MatchSummary[]>();
    for (const m of list.filter((x) => !isEffectivelyLive(x.status, x.scheduledAt))) {
      const key = formatDayKey(m.scheduledAt) || 'nodate';
      const bucket = byDay.get(key) ?? [];
      bucket.push(m);
      byDay.set(key, bucket);
    }
    return [
      ...(live.length ? [{ key: '__live__', title: t('match_states.live'), matches: live }] : []),
      ...[...byDay.entries()].map(([key, matches]) => ({
        key,
        title: key === 'nodate' ? '—' : formatDayLabel(matches[0]?.scheduledAt ?? null),
        matches,
      })),
    ];
  }, [data, t]);

  // Native in-feed (Plan D Task 6): items sintéticos SOLO con la config
  // cargada y el formato enabled (fail-safe: sin config ⇒ sin items). Un
  // único punto de inserción (v1): tras el `everyNItems`-ésimo partido.
  const everyNItems =
    adsConfig?.nativeFeed.enabled === true ? adsConfig.nativeFeed.everyNItems : undefined;
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const s of sections) {
      items.push({ kind: 'header', key: `header:${s.key}`, title: s.title });
      for (const m of s.matches) items.push({ kind: 'match', key: `match:${m.id}`, match: m });
    }
    const matchCount = items.reduce((n, it) => (it.kind === 'match' ? n + 1 : n), 0);
    const [position] = insertNativeAdPositions(matchCount, everyNItems);
    if (position === undefined) return items;
    const out: FeedItem[] = [];
    let seen = 0;
    for (const it of items) {
      out.push(it);
      if (it.kind === 'match' && ++seen === position) out.push({ kind: 'ad', key: 'native-ad' });
    }
    return out;
  }, [sections, everyNItems]);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-rink-floor dark:bg-rink-floor-dark">
        <BrandLoader />
      </View>
    );
  }
  // Con datos previos (fallo de refetch en segundo plano) se CONSERVA la lista:
  // el ErrorState solo sustituye la pantalla si no hay nada que mostrar.
  if (isError && !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <FlatList
      className="bg-rink-floor dark:bg-rink-floor-dark"
      contentContainerStyle={{ flexGrow: 1 }}
      data={feed}
      keyExtractor={(item) => item.key}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      renderItem={({ item }) => {
        if (item.kind === 'header') {
          return (
            <Text className="px-4 pb-1 pt-3 text-xs font-bold uppercase text-slate-500">
              {item.title}
            </Text>
          );
        }
        if (item.kind === 'ad') return <NativeFeedAd />;
        return <MatchCard match={item.match} />;
      }}
      ListEmptyComponent={
        <EmptyState title={t('common.no_matches_today')} hint={t('common.no_matches_hint')} />
      }
      ListFooterComponent={<AdBanner variant="list" />}
    />
  );
}
