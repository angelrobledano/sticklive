// app/competitions/[id]/loading.tsx — Skeleton del Competition Center
import { TableSkeleton } from '@/components/shared/TableSkeleton';

export default function CompetitionLoading() {
  return (
    <div className="animate-pulse px-4 py-4 max-w-2xl mx-auto space-y-5">
      {/* Back link */}
      <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" />

      {/* ── Competition Header ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
        {/* Logo + nombre */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-slate-200 dark:bg-slate-700 shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-40 rounded-lg bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
        {/* Stats row */}
        <div className="flex gap-6 pt-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="h-4 w-6 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2.5 w-12 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-2">
        {['Clasificación', 'Jornadas', 'Playoffs'].map((label) => (
          <div key={label} className="flex-1 h-9 rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>

      {/* ── Clasificación skeleton con cabecera de stats ── */}
      <div className="space-y-1">
        {/* Header de columnas */}
        <div className="flex items-center gap-1 px-3 py-1">
          <div className="w-5 h-2 rounded bg-slate-200 dark:bg-slate-700 shrink-0" />
          <div className="flex-1" />
          {['PJ','G','E','P','Pts'].map((col) => (
            <div key={col} className="w-7 h-2 rounded bg-slate-200 dark:bg-slate-700 shrink-0" />
          ))}
        </div>

        {/* 14 equipos */}
        <TableSkeleton rows={14} cols={5} hasIndex />
      </div>
    </div>
  );
}
