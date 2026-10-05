/**
 * Iconos presentacionales de la ficha de partido. Sin estado ni lógica.
 */
import type { MatchEventType } from '@/lib/api/client';

export function EventIcon({ type }: { type: MatchEventType | 'accumulated_foul' }) {
  switch (type) {
    case 'goal':
      return (
        <div className="w-7 h-7 rounded-full bg-slate-800 dark:bg-white flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.5} className="w-4 h-4 dark:stroke-slate-900">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3C12 3 9 7 9 12s3 9 3 9M12 3c0 0 3 4 3 9s-3 9-3 9M3 12h18" strokeWidth={1} />
          </svg>
        </div>
      );
    case 'blue_card':
      return (
        <div className="w-5 h-7 rounded-sm bg-blue-500 flex items-center justify-center shrink-0">
          <span aria-hidden="true" className="text-white text-[10px] font-extrabold leading-none">A</span>
        </div>
      );
    case 'red_card':
      return (
        <div className="w-5 h-7 rounded-sm bg-red-600 flex items-center justify-center shrink-0">
          <span aria-hidden="true" className="text-white text-[10px] font-extrabold leading-none">R</span>
        </div>
      );
    case 'penalty':
      return (
        <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
          <span aria-hidden="true" className="text-white text-[10px] font-extrabold">P</span>
        </div>
      );
    case 'timeout':
      return (
        <div className="w-7 h-7 rounded-full bg-slate-400 dark:bg-slate-600 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'accumulated_foul':
      return (
        <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
            <path d="M10.3 3.7L2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'direct_foul':
      return (
        <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="12" cy="12" r="1" fill="white" />
          </svg>
        </div>
      );
    default:
      return <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />;
  }
}

/** Trofeo — marca al campeón de una serie o competición. Trazo consistente. */
export function TrophyIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         className={className} aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" strokeLinejoin="round" />
      <path d="M8 5H6a2 2 0 0 0 2 4" strokeLinecap="round" />
      <path d="M16 5h2a2 2 0 0 1-2 4" strokeLinecap="round" />
      <path d="M12 13v4" strokeLinecap="round" />
      <path d="M9 17h6" strokeLinecap="round" />
      <path d="M8 21h8" strokeLinecap="round" />
    </svg>
  );
}

/** Bola de hockey: negra con anillo sutil (visible en ambos temas) */
export function BallIcon({ size = 9 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block rounded-full bg-slate-900 dark:bg-white
                 ring-1 ring-slate-400/60 dark:ring-slate-500/60 shrink-0"
      aria-hidden="true"
    />
  );
}

/** Icono mínimo para faltas individuales (nivel bajo) */
export function FoulDot() {
  return (
    <span className="w-4 h-4 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 dark:bg-orange-500" />
    </span>
  );
}

/** Icono mínimo para tiempos muertos (nivel bajo) */
export function TimeoutDot() {
  return (
    <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
