// app/teams/[id]/loading.tsx — Skeleton del Team Center
import { TableSkeleton } from '@/components/shared/TableSkeleton';

function FormBadgeSkeleton() {
  return <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />;
}

export default function TeamLoading() {
  return (
    <div className="animate-pulse px-4 py-4 max-w-2xl mx-auto space-y-5">
      {/* Back link */}
      <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700" />

      {/* ── Team Header ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />

          <div className="flex-1 space-y-2">
            {/* Nombre */}
            <div className="h-5 w-36 rounded-lg bg-slate-200 dark:bg-slate-700" />
            {/* Ciudad / país */}
            <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            {/* Competición */}
            <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>

        {/* Standing mini-row */}
        <div className="mt-4 flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="h-4 w-6 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2.5 w-6 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>

        {/* Form badges */}
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => <FormBadgeSkeleton key={i} />)}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-2">
        {['Calendario', 'Plantilla'].map((label) => (
          <div key={label} className="flex-1 h-9 rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>

      {/* ── Plantilla / tabla ── */}
      <TableSkeleton rows={10} cols={5} hasIndex />
    </div>
  );
}
