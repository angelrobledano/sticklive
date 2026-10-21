import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, playerPhotoUri } from '@/src/components/shared/Avatar';
import {
  displayLineupName,
  placeRinkPlayers,
  type PlacedRinkPlayer,
  type RinkPlayer,
} from '@/src/lib/match-helpers';

interface StartingFiveRinkProps {
  home: RinkPlayer[];
  away: RinkPlayer[];
  homeName: string;
  awayName: string;
}

function RinkChip({ placed }: { placed: PlacedRinkPlayer }) {
  const router = useRouter();
  const { p, x, y, isAway } = placed;
  const surname = displayLineupName(p.playerName).split(' ').slice(-1)[0] ?? p.playerName;

  const content = (
    <View className="items-center">
      {/* Avatar circular con anillo de equipo */}
      <View
        className="rounded-full items-center justify-center shadow-sm"
        style={{
          borderWidth: 2,
          borderColor: isAway ? '#ffffff' : BRAND.granate,
          backgroundColor: '#ffffff',
        }}
      >
        <Avatar
          uri={p.playerId ? playerPhotoUri(p.playerId, 64) : p.photoUrl}
          fallbackUri={p.photoUrl}
          name={p.playerName}
          size={32}
          variant="player"
        />

        {/* Dorsal en la esquina inferior derecha */}
        <View
          className="absolute -bottom-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full items-center justify-center shadow-xs"
          style={{
            backgroundColor: isAway ? '#ffffff' : BRAND.granate,
            borderWidth: isAway ? 1 : 0,
            borderColor: '#cbd5e1',
          }}
        >
          <Text
            className="font-mono text-[9px] font-bold"
            style={{ color: isAway ? '#1e293b' : '#ffffff' }}
          >
            {p.jerseyNumber ?? '–'}
          </Text>
        </View>

        {/* Badge Capitán en la esquina superior derecha */}
        {p.isCaptain ? (
          <View className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-800 items-center justify-center">
            <Text className="text-[8px] font-black text-white">C</Text>
          </View>
        ) : null}
      </View>

      {/* Apellido del jugador */}
      <View className="mt-0.5 max-w-[66px] rounded bg-slate-900/80 px-1 py-0.5 items-center">
        <Text
          className="text-[9px] font-semibold text-white text-center leading-tight"
          numberOfLines={1}
        >
          {surname}
        </Text>
      </View>
    </View>
  );

  return (
    <View
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        marginLeft: -33,
        marginTop: -22,
        width: 66,
      }}
    >
      {p.playerId ? (
        <Pressable
          onPress={() => router.push(`/player/${p.playerId}`)}
          className="active:scale-95 items-center"
          hitSlop={6}
        >
          {content}
        </Pressable>
      ) : (
        <View className="items-center">{content}</View>
      )}
    </View>
  );
}

export function StartingFiveRink({ home, away, homeName, awayName }: StartingFiveRinkProps) {
  const { t } = useLocale();

  const positionedPlayers = useMemo(() => {
    const homePlaced = placeRinkPlayers(home, false);
    const awayPlaced = placeRinkPlayers(away, true);
    return [...homePlaced, ...awayPlaced];
  }, [home, away]);

  if (home.length === 0 && away.length === 0) {
    return null;
  }

  return (
    <View className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900 border border-slate-100 dark:border-slate-800 mb-3">
      {/* Cabecera del 5 inicial */}
      <View className="flex-row items-center justify-between pb-2.5">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('match_detail.starter')}
        </Text>
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-1.5">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: BRAND.granate }}
            />
            <Text
              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 max-w-[90px]"
              numberOfLines={1}
            >
              {homeName}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-full bg-white border border-slate-300 dark:border-slate-600" />
            <Text
              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 max-w-[90px]"
              numberOfLines={1}
            >
              {awayName}
            </Text>
          </View>
        </View>
      </View>

      {/* Pista de hockey patines reglamentaria (2:1 aspect ratio) */}
      <View className="relative w-full aspect-[2/1] rounded-2xl overflow-hidden bg-sky-700 dark:bg-slate-800 border-2 border-sky-900/40 dark:border-slate-950">
        {/* Línea central */}
        <View className="absolute top-0 bottom-0 left-1/2 w-px bg-white/45" />

        {/* Círculo central y punto de saque */}
        <View className="absolute inset-0 items-center justify-center pointer-events-none">
          <View className="w-[18%] aspect-square rounded-full border border-white/50 items-center justify-center">
            <View className="w-1.5 h-1.5 rounded-full bg-white/80" />
          </View>
        </View>

        {/* Área de portería izquierda */}
        <View
          style={{
            position: 'absolute',
            left: '6%',
            top: '27%',
            width: '14%',
            height: '46%',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.45)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: '3.5%',
            top: '40%',
            width: '5%',
            height: '20%',
            borderRadius: 9999,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.45)',
          }}
        />
        {/* Puntos de penalti / falta directa izquierda */}
        <View
          style={{
            position: 'absolute',
            left: '22.5%',
            top: '48%',
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: 'rgba(255,255,255,0.7)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: '27%',
            top: '48%',
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: 'rgba(255,255,255,0.7)',
          }}
        />
        {/* Portería izquierda */}
        <View
          style={{
            position: 'absolute',
            left: '4.8%',
            top: '42%',
            width: '1.2%',
            height: '16%',
            backgroundColor: 'rgba(255,255,255,0.7)',
            borderTopLeftRadius: 3,
            borderBottomLeftRadius: 3,
          }}
        />

        {/* Área de portería derecha (espejada) */}
        <View
          style={{
            position: 'absolute',
            right: '6%',
            top: '27%',
            width: '14%',
            height: '46%',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.45)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: '3.5%',
            top: '40%',
            width: '5%',
            height: '20%',
            borderRadius: 9999,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.45)',
          }}
        />
        {/* Puntos de penalti / falta directa derecha */}
        <View
          style={{
            position: 'absolute',
            right: '22.5%',
            top: '48%',
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: 'rgba(255,255,255,0.7)',
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: '27%',
            top: '48%',
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: 'rgba(255,255,255,0.7)',
          }}
        />
        {/* Portería derecha */}
        <View
          style={{
            position: 'absolute',
            right: '4.8%',
            top: '42%',
            width: '1.2%',
            height: '16%',
            backgroundColor: 'rgba(255,255,255,0.7)',
            borderTopRightRadius: 3,
            borderBottomRightRadius: 3,
          }}
        />

        {/* Jugadores del 5 inicial sobre la pista */}
        {positionedPlayers.map((placed, i) => (
          <RinkChip key={`${placed.p.playerName}-${i}`} placed={placed} />
        ))}
      </View>
    </View>
  );
}
