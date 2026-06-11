/** Bloque schema.org (JSON-LD) — server component, sin hidratación */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify escapa <> por defecto en valores; suficiente aquí
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
