/**
 * Bloque schema.org (JSON-LD) — server component, sin hidratación.
 *
 * JSON.stringify NO escapa `<` `>` `&`, así que un nombre de equipo/jugador
 * scrapeado con "</script>" podría romper el bloque e inyectar HTML (XSS,
 * auditoría S5). Escapamos esos caracteres a su forma unicode dentro del JSON,
 * que sigue siendo JSON válido y ya no puede cerrar el <script>.
 */
function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
