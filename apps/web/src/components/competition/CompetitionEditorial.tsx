import { competitionEditorial } from '@/lib/competition-editorial';

/**
 * Bloque editorial al final de la ficha de competición. Server component:
 * el texto viaja en el HTML y complementa los datos dinámicos de las pestañas.
 */
export function CompetitionEditorial({ slug, locale }: { slug: string | null | undefined; locale: string }) {
  const content = competitionEditorial(slug, locale);
  if (!content) return null;

  return (
    <section className="card p-5 space-y-4" aria-labelledby="competition-editorial-title">
      <h2
        id="competition-editorial-title"
        className="text-sm font-semibold text-slate-700 dark:text-slate-300"
      >
        {content.title}
      </h2>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{content.intro}</p>

      {content.sections.map((section) => (
        <div key={section.heading} className="space-y-1.5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {section.heading}
          </h3>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {paragraph}
            </p>
          ))}
          {section.bullets && section.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          )}
        </div>
      ))}

      {content.source && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {locale === 'en' ? 'Source' : locale === 'ca' ? 'Font' : 'Fuente'}:{' '}
          <a
            href={content.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-rink-passion dark:hover:text-rink-accent"
          >
            {content.source.label}
          </a>
        </p>
      )}
    </section>
  );
}
