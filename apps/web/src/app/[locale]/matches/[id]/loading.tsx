// app/matches/[id]/loading.tsx — Skeleton del Match Center

function TeamBlockSkeleton() {
  return (
    <div className="flex-1 flex flex-col items-center gap-2">
      {/* Escudo */}
      <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-700" />
      {/* Nombre */}
      <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

function TimelineNodeSkeleton({ side }: { side: 'left' | 'right' | 'center' }) {
  const isCenter = side === 'center';
  return (
    <div className="flex items-center gap-2">
      {/* Contenido izquierdo */}
      <div className={`flex-1 flex justify-end ${side === 'right' ? 'invisible' : ''}`}>
        {!isCenter && (
          <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        )}
      </div>

      {/* Nodo central */}
      <div className="shrink-0 flex flex-col items-center gap-1">
        <div className={`rounded-full bg-slate-200 dark:bg-slate-700 ${isCenter ? 'w-3 h-3' : 'w-4 h-4'}`} />
      </div>

      {/* Contenido derecho */}
      <div className={`flex-1 ${side === 'left' ? 'invisible' : ''}`}>
        {!isCenter && (
          <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        )}
      </div>
    </div>
  );
}

const TIMELINE_ITEMS: Array<'left' | 'right' | 'center'> = [
  'left', 'right', 'center', 'left', 'center', 'right', 'left',
];

export default function MatchLoading() {
  return (
    <div className="animate-pulse px-4 py-4 max-w-2xl mx-auto space-y-5">
      {/* Back link */}
      <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" />

      {/* ── Match Header ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        {/* Competition badge */}
        <div className="mx-auto h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" />

        {/* Teams + Score */}
        <div className="flex items-center gap-4">
          <TeamBlockSkeleton />

          {/* Score */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="h-12 w-20 rounded-xl bg-slate-200 dark:bg-slate-700" />
            <div className="h-2.5 w-12 rounded bg-slate-200 dark:bg-slate-700" />
          </div>

          <TeamBlockSkeleton />
        </div>

        {/* Fouls row */}
        <div className="flex justify-between px-4">
          <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-2">
        {['Resumen', 'Alineaciones', 'Estadísticas'].map((label) => (
          <div key={label} className="flex-1 h-9 rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>

      {/* ── Timeline ── */}
      <div className="relative">
        {/* Línea vertical central */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700 rounded-full" />

        <div className="space-y-5 py-2 relative z-10">
          {TIMELINE_ITEMS.map((side, i) =>
            side === 'center' ? (
              /* Separador de periodo */
              <div key={i} className="flex items-center justify-center">
                <div className="h-5 w-24 rounded-full bg-slate-200 dark:bg-slate-700" />
              </div>
            ) : (
              <TimelineNodeSkeleton key={i} side={side} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
