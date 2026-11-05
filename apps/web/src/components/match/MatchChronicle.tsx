import type { ChronicleFact } from '@sports/core/match-chronicle';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { toTitleCase } from '@sports/core/names';

interface Copy {
  title: string;
  comeback: string;
  turnaround: string;
  lateGoal: (minute?: number) => string;
  cleanSheet: string;
  hatTrickBefore: string;
  hatTrickAfter: string;
  shootout: (home: number, away: number, rounds: number, scored: number, attempts: number) => string;
  openingPrefix: (minute: number) => string;
  periodHome: (first: number, second: number) => string;
  periodAway: (first: number, second: number) => string;
  lateEqualizer: (score: number, minute: number) => string;
  directFoul: (minute: number) => string;
  flurry: (n: number, from: number, to: number) => string;
  fouls: string;
  timeouts: string;
}

const COPY: Record<string, Copy> = {
  es: {
    title: 'Crónica de datos',
    comeback: ': perdía al descanso y ganó al final.',
    turnaround: ' remontó un partido que iba perdiendo.',
    lateGoal: (m) => ` marcó en los últimos cinco minutos${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' dejó la portería a cero.',
    hatTrickBefore: 'Hat-trick de ',
    hatTrickAfter: '.',
    shootout: (home, away, rounds, scored, attempts) => ` ganó la tanda de penaltis ${home}-${away} tras ${rounds} rondas; solo ${scored} de ${attempts} lanzamientos acabaron en gol.`,
    openingPrefix: (m) => `Primer gol en el ${m}': `,
    periodHome: (a, b) => `marcó ${a} en la primera parte y ${b} en la segunda parte`,
    periodAway: (a, b) => `marcó ${a} en la primera parte y ${b} en la segunda parte`,
    lateEqualizer: (score, m) => `empató a ${score} en el ${m}'`,
    directFoul: (m) => ` marcó de falta directa en el ${m}'.`,
    flurry: (n, from, to) => `marcó ${n} goles en ${to - from} minutos (${from}' y ${to}').`,
    fouls: 'Faltas',
    timeouts: 'Tiempos muertos',
  },
  en: {
    title: 'Match facts',
    comeback: ' came from behind at half-time to win.',
    turnaround: ' came from behind to lead the match.',
    lateGoal: (m) => ` scored in the last five minutes${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' kept a clean sheet.',
    hatTrickBefore: 'Hat-trick: ',
    hatTrickAfter: '.',
    shootout: (home, away, rounds, scored, attempts) => ` won the penalty shootout ${home}-${away} after ${rounds} rounds; only ${scored} of ${attempts} attempts were scored.`,
    openingPrefix: (m) => `First goal in the ${m}th minute: `,
    periodHome: (a, b) => `scored ${a} in the first half and ${b} in the second half`,
    periodAway: (a, b) => `scored ${a} in the first half and ${b} in the second half`,
    lateEqualizer: (score, m) => `equalised at ${score} in the ${m}th minute`,
    directFoul: (m) => ` scored from a direct free hit in the ${m}th minute.`,
    flurry: (n, from, to) => `scored ${n} goals in ${to - from} minutes (${from}th and ${to}th).`,
    fouls: 'Fouls',
    timeouts: 'Timeouts',
  },
  pt: {
    title: 'Crónica de dados',
    comeback: ': perdia ao intervalo e venceu no final.',
    turnaround: ' deu a volta a um jogo que estava a perder.',
    lateGoal: (m) => ` marcou nos últimos cinco minutos${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' não sofreu golos.',
    hatTrickBefore: 'Hat-trick de ',
    hatTrickAfter: '.',
    shootout: (home, away, rounds, scored, attempts) => ` venceu nos penáltis ${home}-${away} após ${rounds} rondas; só ${scored} de ${attempts} remates entraram.`,
    openingPrefix: (m) => `Primeiro golo no minuto ${m}: `,
    periodHome: (a, b) => `marcou ${a} na primeira parte e ${b} na segunda parte`,
    periodAway: (a, b) => `marcou ${a} na primeira parte e ${b} na segunda parte`,
    lateEqualizer: (score, m) => `empatou a ${score} no minuto ${m}`,
    directFoul: (m) => ` marcou de livre direto no minuto ${m}.`,
    flurry: (n, from, to) => `marcou ${n} golos em ${to - from} minutos (${from}' e ${to}').`,
    fouls: 'Faltas',
    timeouts: 'Tempos mortos',
  },
  fr: {
    title: 'Faits du match',
    comeback: ' a renversé le match après avoir été mené à la mi-temps.',
    turnaround: ' a renversé un match qu’il perdait.',
    lateGoal: (m) => ` a marqué dans les cinq dernières minutes${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' n’a encaissé aucun but.',
    hatTrickBefore: 'Triplé de ',
    hatTrickAfter: '.',
    shootout: (home, away, rounds, scored, attempts) => ` a gagné la séance de tirs au but ${home}-${away} après ${rounds} tours ; seuls ${scored} tirs sur ${attempts} ont été marqués.`,
    openingPrefix: (m) => `Premier but à la ${m}e minute : `,
    periodHome: (a, b) => `a marqué ${a} en première période et ${b} en seconde`,
    periodAway: (a, b) => `a marqué ${a} en première période et ${b} en seconde`,
    lateEqualizer: (score, m) => `a égalisé à ${score} à la ${m}e minute`,
    directFoul: (m) => ` a marqué sur coup franc direct à la ${m}e minute.`,
    flurry: (n, from, to) => `a marqué ${n} buts en ${to - from} minutes (${from}e et ${to}e).`,
    fouls: 'Fautes',
    timeouts: 'Temps morts',
  },
  it: {
    title: 'Fatti della partita',
    comeback: ' ha rimontato dopo essere andato sotto all’intervallo.',
    turnaround: ' ha rimontato una partita che stava perdendo.',
    lateGoal: (m) => ` ha segnato negli ultimi cinque minuti${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' non ha subito gol.',
    hatTrickBefore: 'Tripletta di ',
    hatTrickAfter: '.',
    shootout: (home, away, rounds, scored, attempts) => ` ha vinto ai rigori ${home}-${away} dopo ${rounds} serie; solo ${scored} tiri su ${attempts} sono entrati.`,
    openingPrefix: (m) => `Primo gol al minuto ${m}: `,
    periodHome: (a, b) => `ha segnato ${a} nel primo tempo e ${b} nel secondo`,
    periodAway: (a, b) => `ha segnato ${a} nel primo tempo e ${b} nel secondo`,
    lateEqualizer: (score, m) => `ha pareggiato sul ${score} al minuto ${m}`,
    directFoul: (m) => ` ha segnato su tiro diretto al minuto ${m}.`,
    flurry: (n, from, to) => `ha segnato ${n} gol in ${to - from} minuti (${from}° e ${to}°).`,
    fouls: 'Falli',
    timeouts: 'Time-out',
  },
};

function Team({ id, name }: { id: string; name: string }) {
  return <Link href={`/teams/${id}`} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{name}</Link>;
}

function Player({ id, name }: { id?: string; name: string }) {
  return id
    ? <Link href={`/players/${id}`} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{name}</Link>
    : <span className="font-semibold">{name}</span>;
}

/** Hechos server-rendered de un partido terminado, solo si el acta los respalda. */
export function MatchChronicle({ facts, locale, teams }: {
  facts: ChronicleFact[];
  locale: string;
  teams: Record<string, string>;
}) {
  if (facts.length === 0) return null;
  const c = COPY[locale] ?? COPY['en']!;
  const teamName = (id?: string) => (id ? teams[id] ?? '' : '');
  const num = (v: number | string | undefined) => Number(v ?? 0);
  const player = (f: ChronicleFact) => f.playerName ? toTitleCase(f.playerName) : '';

  return (
    <section className="card p-4 space-y-2" aria-labelledby="match-chronicle-title">
      <h2 id="match-chronicle-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {c.title}
      </h2>
      <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        {facts.map((f, i) => {
          if (f.kind === 'shootout') {
            const home = num(f.values?.['home']);
            const away = num(f.values?.['away']);
            return <li key={i}><Team id={f.teamId!} name={teamName(f.teamId)} />{c.shootout(home, away, num(f.values?.['rounds']), num(f.values?.['scored']), num(f.values?.['attempts']))}</li>;
          }
          if (f.kind === 'comeback' || f.kind === 'turnaround') {
            return <li key={i}><Team id={f.teamId!} name={teamName(f.teamId)} />{f.kind === 'comeback' ? c.comeback : c.turnaround}</li>;
          }
          if (f.kind === 'period_goals') {
            const [homeId, awayId] = f.teamIds ?? [];
            return (
              <li key={i}>
                <Team id={homeId!} name={teamName(homeId)} /> {c.periodHome(num(f.values?.['homeFirst']), num(f.values?.['homeSecond']))} ·{' '}
                <Team id={awayId!} name={teamName(awayId)} /> {c.periodAway(num(f.values?.['awayFirst']), num(f.values?.['awaySecond']))}.
              </li>
            );
          }
          if (f.kind === 'opening_goal') {
            const minute = num(f.minute ?? f.values?.['minute']);
            return <li key={i}>{c.openingPrefix(minute)}<Player id={f.playerId} name={player(f)} /> ({teamName(f.teamId)}).</li>;
          }
          if (f.kind === 'late_equalizer') {
            return <li key={i}><Team id={f.teamId!} name={teamName(f.teamId)} /> {c.lateEqualizer(num(f.values?.['home']), num(f.minute))} (<Player id={f.playerId} name={player(f)} />).</li>;
          }
          if (f.kind === 'goal_flurry') {
            return <li key={i}><Team id={f.teamId!} name={teamName(f.teamId)} /> {c.flurry(num(f.values?.['n']), num(f.values?.['from']), num(f.values?.['to']))}</li>;
          }
          if (f.kind === 'direct_foul_goal') {
            return <li key={i}><Player id={f.playerId} name={player(f)} /> ({teamName(f.teamId)}){c.directFoul(num(f.minute))}</li>;
          }
          if (f.kind === 'hat_trick') {
            return <li key={i}>{c.hatTrickBefore}<Player id={f.playerId} name={player(f)} />{c.hatTrickAfter}</li>;
          }
          if (f.kind === 'fouls' || f.kind === 'timeouts') {
            const [homeId, awayId] = f.teamIds ?? [];
            const prefix = f.kind === 'fouls' ? c.fouls : c.timeouts;
            return (
              <li key={i}>
                {prefix}: <Team id={homeId!} name={teamName(homeId)} /> {num(f.values?.['home'])} · <Team id={awayId!} name={teamName(awayId)} /> {num(f.values?.['away'])}.
              </li>
            );
          }
          const suffix = f.kind === 'late_goal' ? c.lateGoal(f.minute) : c.cleanSheet;
          return <li key={i}><Team id={f.teamId!} name={teamName(f.teamId)} />{suffix}</li>;
        })}
      </ul>
    </section>
  );
}
