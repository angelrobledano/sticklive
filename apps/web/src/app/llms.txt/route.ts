import { SITE_URL } from '@/lib/seo';

/**
 * `/llms.txt` — resumen del sitio para agentes y modelos.
 *
 * Convención emergente (llmstxt.org), no un estándar de Google ni un sustituto
 * del sitemap. Se mantiene pequeño y estable: qué ofrece el sitio, idiomas,
 * páginas de entrada y dónde están los datos completos. Los enlaces apuntan a
 * las URLs canónicas con idioma.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  const body = `# Stick Live

> Resultados, estadísticas y alineaciones de hockey sobre patines en directo.
> Cubre competiciones de la RFEP y World Skate Europe, con datos actualizados
> al segundo durante los partidos.

## Qué ofrece

- Marcadores en directo y resultados finales.
- Clasificaciones, calendario y eliminatorias por competición.
- Fichas de equipo, plantilla, estadísticas y fichas de jugador.
- Versiones en español, inglés, portugués, francés e italiano.

## Entrada principal

- [Portada en español](${SITE_URL}/es)
- [Competiciones](${SITE_URL}/es/competitions)
- [Buscar equipos, jugadores y competiciones](${SITE_URL}/es/search)
- [Portada en inglés](${SITE_URL}/en)
- [Portada en portugués](${SITE_URL}/pt)

## Datos completos

- [Índice de sitemaps](${SITE_URL}/sitemap-index.xml): competiciones, equipos,
  jugadores y partidos recientes/próximos, con hreflang y canonical.
- [API pública](${SITE_URL}/api): los datos que alimentan las fichas.

## Cobertura y uso

- Mercado principal: España; segundo: Portugal.
- Contenido público; no requiere autenticación.
- Las páginas privadas (/{idioma}/admin, /login, /settings, /favorites,
  /premium/*) no forman parte del contenido indexable.

## Política

- [Sobre Stick Live](${SITE_URL}/es/about)
- [Contacto](${SITE_URL}/es/contact)
- [Aviso legal](${SITE_URL}/es/legal)
- [Privacidad](${SITE_URL}/es/privacy)
- No se publican datos personales de menores más allá de lo que ya aparece en
  las fuentes deportivas oficiales.
`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
