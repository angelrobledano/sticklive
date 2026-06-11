// Componente reutilizable de skeleton para cualquier tabla (clasificación, plantilla, etc.)

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  /** Si true, pinta una primera columna estrecha (número de posición / dorsal) */
  hasIndex?: boolean;
}

export function TableSkeleton({ rows = 8, cols = 5, hasIndex = true }: TableSkeletonProps) {
  return (
    <div className="w-full space-y-px">
      {/* Cabecera */}
      <div className="flex items-center gap-2 px-3 py-2 mb-1">
        {hasIndex && <div className="w-6 h-2.5 rounded bg-slate-200 dark:bg-slate-700 shrink-0" />}
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className={`h-2.5 rounded bg-slate-200 dark:bg-slate-700 ${i === 0 ? 'flex-1' : 'w-8 shrink-0'}`}
          />
        ))}
      </div>

      {/* Filas */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800"
        >
          {hasIndex && (
            <div className="w-5 h-3 rounded bg-slate-200 dark:bg-slate-700 shrink-0" />
          )}
          {/* Logo circular */}
          <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
          {/* Nombre — columna flexible */}
          <div className="flex-1 h-3 rounded bg-slate-200 dark:bg-slate-700" style={{ maxWidth: `${55 + Math.random() * 30}%` }} />
          {/* Columnas de stats */}
          {Array.from({ length: cols - 1 }).map((_, colIdx) => (
            <div key={colIdx} className="w-7 h-3 rounded bg-slate-200 dark:bg-slate-700 shrink-0" />
          ))}
        </div>
      ))}
    </div>
  );
}
