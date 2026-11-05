import type { ChronicleFact, ChronicleKind } from '@sports/core/match-chronicle';
import { toTitleCase } from '@sports/core/names';

/**
 * Frase de la crónica de datos partida en trozos (paridad con
 * apps/web/src/components/match/MatchChronicle.tsx): los equipos y jugadores
 * salen como trozos enlazables y el resto como texto. Las plantillas viven en
 * `match_chronicle.*` de los locales compartidos.
 */
export interface ChronicleSegment {
  text: string;
  teamId?: string;
  playerId?: string;
}

const KEY: Record<ChronicleKind, string> = {
  comeback: 'comeback',
  turnaround: 'turnaround',
  hat_trick: 'hat_trick',
  late_goal: 'late_goal',
  clean_sheet: 'clean_sheet',
  shootout: 'shootout',
  opening_goal: 'opening_goal',
  late_equalizer: 'late_equalizer',
  period_goals: 'period_goals',
  goal_flurry: 'goal_flurry',
  direct_foul_goal: 'direct_foul',
  fouls: 'fouls',
  timeouts: 'timeouts',
};

export function chronicleSegments(
  fact: ChronicleFact,
  t: (key: string) => string,
  teams: Record<string, string>,
): ChronicleSegment[] {
  const template = t(`match_chronicle.${KEY[fact.kind]}`);
  const teamName = (id?: string) => (id ? teams[id] ?? '' : '');
  const num = (v: number | string | undefined) => String(Number(v ?? 0));
  const values = fact.values ?? {};
  const [homeId, awayId] = fact.teamIds ?? [];
  const minute = fact.minute ?? values['minute'];
  const player = fact.playerName ? toTitleCase(fact.playerName) : '';

  const resolve = (name: string): ChronicleSegment | null => {
    switch (name) {
      case 'team': return { text: teamName(fact.teamId), teamId: fact.teamId };
      case 'teamName': return { text: teamName(fact.teamId) };
      case 'homeTeam': return { text: teamName(homeId), teamId: homeId };
      case 'awayTeam': return { text: teamName(awayId), teamId: awayId };
      case 'player': return fact.playerId ? { text: player, playerId: fact.playerId } : { text: player };
      case 'minute': return { text: num(minute) };
      case 'score': return { text: num(values['home']) };
      case 'span': return { text: String(Number(values['to'] ?? 0) - Number(values['from'] ?? 0)) };
      default: return name in values ? { text: num(values[name]) } : null;
    }
  };

  const out: ChronicleSegment[] = [];
  const push = (seg: ChronicleSegment) => {
    if (!seg.text) return;
    const last = out[out.length - 1];
    // Texto plano seguido se funde en un solo trozo.
    if (last && !last.teamId && !last.playerId && !seg.teamId && !seg.playerId) last.text += seg.text;
    else out.push(seg);
  };
  let cursor = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    push({ text: template.slice(cursor, m.index) });
    const seg = resolve(m[1]!);
    push(seg ?? { text: m[0] });
    cursor = (m.index ?? 0) + m[0].length;
  }
  push({ text: template.slice(cursor) });
  return out.map((s) => (s.teamId || s.playerId ? s : { text: s.text }));
}
