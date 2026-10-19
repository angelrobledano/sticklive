import type { ChronicleFact } from '@/lib/match-chronicle';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { toTitleCase } from '@/lib/names';

const COPY: Record<string, {
  title: string;
  comeback: string;
  hatTrickBefore: string;
  hatTrickAfter: string;
  lateGoal: (minute?: number) => string;
  cleanSheet: string;
  shootout: string;
}> = {
  es: {
    title: 'Crónica de datos',
    comeback: ': perdía al descanso y ganó al final.',
    hatTrickBefore: 'Hat-trick de ',
    hatTrickAfter: '.',
    lateGoal: (m) => ` marcó en los últimos cinco minutos${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' dejó la portería a cero.',
    shootout: ' ganó en la tanda de penaltis.',
  },
  en: {
    title: 'Match facts',
    comeback: ' came from behind at half-time to win.',
    hatTrickBefore: 'Hat-trick: ',
    hatTrickAfter: '.',
    lateGoal: (m) => ` scored in the last five minutes${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' kept a clean sheet.',
    shootout: ' won the penalty shootout.',
  },
  pt: {
    title: 'Crónica de dados',
    comeback: ' deu a volta depois de perder ao intervalo.',
    hatTrickBefore: 'Hat-trick de ',
    hatTrickAfter: '.',
    lateGoal: (m) => ` marcou nos últimos cinco minutos${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' não sofreu golos.',
    shootout: ' venceu nos penáltis.',
  },
  fr: {
    title: 'Faits du match',
    comeback: ' a renversé le match après avoir été mené à la mi-temps.',
    hatTrickBefore: 'Triplé de ',
    hatTrickAfter: '.',
    lateGoal: (m) => ` a marqué dans les cinq dernières minutes${m ? ` (${m}')` : ''}.`,
    cleanSheet: " n'a encaissé aucun but.",
    shootout: ' a gagné aux tirs au but.',
  },
  it: {
    title: 'Fatti della partita',
    comeback: " ha rimontato dopo essere andato sotto all'intervallo.",
    hatTrickBefore: 'Tripletta di ',
    hatTrickAfter: '.',
    lateGoal: (m) => ` ha segnato negli ultimi cinque minuti${m ? ` (${m}')` : ''}.`,
    cleanSheet: ' non ha subito gol.',
    shootout: ' ha vinto ai rigori.',
  },
};

function Team({ id, name }: { id: string; name: string }) {
  return <Link href={`/teams/${id}`} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{name}</Link>;
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

  return (
    <section className="card p-4 space-y-2" aria-labelledby="match-chronicle-title">
      <h2 id="match-chronicle-title" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {c.title}
      </h2>
      <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        {facts.map((f, i) => {
          const name = f.teamId ? teamName(f.teamId) : '';
          if (f.kind === 'hat_trick') {
            const player = f.playerName ? toTitleCase(f.playerName) : '';
            return (
              <li key={i}>
                {c.hatTrickBefore}
                {f.playerId ? <Link href={`/players/${f.playerId}`} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-rink-passion">{player}</Link> : player}
                {c.hatTrickAfter}
              </li>
            );
          }
          const suffix = f.kind === 'comeback' ? c.comeback
            : f.kind === 'late_goal' ? c.lateGoal(f.minute)
            : f.kind === 'clean_sheet' ? c.cleanSheet
            : c.shootout;
          return (
            <li key={i}>
              {f.teamId ? <Team id={f.teamId} name={name} /> : null}
              {suffix}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
