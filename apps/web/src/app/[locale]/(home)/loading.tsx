// app/loading.tsx — Skeleton de la Home (DateSelector + MatchCards)
// Next.js lo muestra automáticamente mientras page.tsx hace el fetch

function MatchCardSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm">
      {/* Equipo local */}
      <div className="flex-1 flex items-center justify-end gap-2">
        <div className="h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
      </div>

      {/* Marcador central */}
      <div className="flex flex-col items-center gap-1 shrink-0 min-w-[72px]">
        <div className="h-2 w-16 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-7 w-14 rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-2 w-10 rounded bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Equipo visitante */}
      <div className="flex-1 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
        <div className="h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}

function DateSelectorSkeleton() {
  return (
    <div className="flex items-center gap-2 px-4 overflow-x-hidden">
      {/* Flecha izquierda */}
      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />

      {/* Píldoras de fecha */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="shrink-0 flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800"
        >
          <div className="h-2 w-5 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      ))}

      {/* Flecha derecha */}
      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div className="animate-pulse px-0 pb-6 space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <div className="h-6 w-40 rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="mt-1 h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Date selector */}
      <DateSelectorSkeleton />

      {/* "Jornada X" label */}
      <div className="px-4">
        <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Match cards */}
      <div className="px-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <MatchCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
