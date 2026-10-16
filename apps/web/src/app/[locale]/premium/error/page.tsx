import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { PurchaseFailedTracker } from '@/components/shared/PurchaseFailedTracker';

interface Props {
  searchParams: Promise<{ order?: string }>;
}

export default async function PremiumErrorPage(props: Props) {
  const searchParams = await props.searchParams;
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center gap-5">
      <PurchaseFailedTracker />
      {/* Icono */}
      <div className="w-20 h-20 rounded-full bg-red-50 dark:bg-red-900/20
                      flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
             className="w-10 h-10 text-rink-passion">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
        </svg>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">
          Pago no completado
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
          La operación fue cancelada o el banco no la autorizó. No se ha realizado
          ningún cargo. Puedes intentarlo de nuevo desde Ajustes.
        </p>
        {searchParams.order && (
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
            Pedido: {searchParams.order}
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/settings"
          className="inline-flex items-center justify-center gap-2 bg-rink-passion hover:bg-rink-passion-light
                     text-white font-semibold text-sm px-5 py-2.5 rounded-xl
                     transition-colors focus:outline-none focus-visible:ring-2
                     focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent focus-visible:ring-offset-2"
        >
          Volver a Ajustes
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800
                     text-slate-700 dark:text-slate-300 font-semibold text-sm px-5 py-2.5 rounded-xl
                     hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
