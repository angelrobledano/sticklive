import type { PlayerFact } from '@/lib/player-facts';

const COPY: Record<string, {
  title: string;
  goals: (n: string, total: number) => string;
  assists: (n: string, total: number) => string;
  participation: (n: string, total: number) => string;
  penalties: (pct: number, total: number) => string;
  discipline: (blue: number, red: number) => string;
}> = {
  es: {
    title: 'Datos de la temporada',
    goals: (n, total) => `${n} goles por partido (${total} en total).`,
    assists: (n, total) => `${n} asistencias por partido (${total} en total).`,
    participation: (n, total) => `Participa en ${n} goles por partido (${total} entre goles y asistencias).`,
    penalties: (pct, total) => `Ha marcado el ${pct} % de sus penaltis (${total} lanzados).`,
    discipline: (blue, red) => `${blue} tarjetas azules y ${red} rojas.`,
  },
  en: {
    title: 'Season facts',
    goals: (n, total) => `${n} goals per match (${total} in total).`,
    assists: (n, total) => `${n} assists per match (${total} in total).`,
    participation: (n, total) => `Involved in ${n} goals per match (${total} goals and assists).`,
    penalties: (pct, total) => `Scored ${pct}% of penalties (${total} taken).`,
    discipline: (blue, red) => `${blue} blue cards and ${red} red cards.`,
  },
  pt: {
    title: 'Dados da temporada',
    goals: (n, total) => `${n} golos por jogo (${total} no total).`,
    assists: (n, total) => `${n} assistências por jogo (${total} no total).`,
    participation: (n, total) => `Participa em ${n} golos por jogo (${total} entre golos e assistências).`,
    penalties: (pct, total) => `Marcou ${pct} % dos seus penáltis (${total} marcados).`,
    discipline: (blue, red) => `${blue} cartões azuis e ${red} vermelhos.`,
  },
  fr: {
    title: 'Chiffres de la saison',
    goals: (n, total) => `${n} buts par match (${total} au total).`,
    assists: (n, total) => `${n} passes décisives par match (${total} au total).`,
    participation: (n, total) => `Impliqué dans ${n} buts par match (${total} buts et passes).`,
    penalties: (pct, total) => `A transformé ${pct} % de ses penalties (${total} tirés).`,
    discipline: (blue, red) => `${blue} cartons bleus et ${red} rouges.`,
  },
  it: {
    title: 'Numeri della stagione',
    goals: (n, total) => `${n} gol a partita (${total} in totale).`,
    assists: (n, total) => `${n} assist a partita (${total} in totale).`,
    participation: (n, total) => `Coinvolto in ${n} gol a partita (${total} tra gol e assist).`,
    penalties: (pct, total) => `Ha segnato il ${pct}% dei rigori (${total} calciati).`,
    discipline: (blue, red) => `${blue} cartellini blu e ${red} rossi.`,
  },
};

export function PlayerFacts({ facts, locale }: { facts: PlayerFact[]; locale: string }) {
  if (facts.length === 0) return null;
  const c = COPY[locale] ?? COPY['en']!;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <section className="card p-4 space-y-2" aria-labelledby="player-facts-title">
      <h2 id="player-facts-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {c.title}
      </h2>
      <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
        {facts.map((f) => {
          const text = f.kind === 'goals_per_match' ? c.goals(num.format(f.value), f.extra ?? 0)
            : f.kind === 'assists_per_match' ? c.assists(num.format(f.value), f.extra ?? 0)
            : f.kind === 'participation' ? c.participation(num.format(f.value), f.extra ?? 0)
            : f.kind === 'penalty_pct' ? c.penalties(f.value, f.extra ?? 0)
            : c.discipline(f.value, f.extra ?? 0);
          return <li key={f.kind}>{text}</li>;
        })}
      </ul>
    </section>
  );
}
