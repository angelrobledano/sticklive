import { isCompetitionSlug } from '@/lib/competition-path';
import type { Metadata } from 'next';
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/lib/locales';
import { isApiNotFound } from '@/lib/api/core';
import { teamQualifiedName } from '@/lib/names';

/** Base pública del sitio — configúrala en producción (sin barra final) */
export const SITE_URL =
  process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3001';

/**
 * Genera canonical + hreflang para una ruta dada.
 *
 * localeAlternates('es', '/competitions') →
 *   canonical: /es/competitions
 *   languages: { es: /es/competitions, en: /en/competitions, ..., x-default: /es/... }
 */
export function localeAlternates(locale: Locale, path = ''): Metadata['alternates'] {
  const clean = path === '/' ? '' : path;
  const languages: Record<string, string> = {};
  for (const l of SUPPORTED_LOCALES) {
    languages[l] = `${SITE_URL}/${l}${clean}`;
  }
  languages['x-default'] = `${SITE_URL}/${FALLBACK_LOCALE}${clean}`;
  return {
    canonical: `${SITE_URL}/${locale}${clean}`,
    languages,
  };
}

export { isSupportedLocale } from '@/lib/locales';

/**
 * Metadata de una página privada: descarta el canonical que hereda del layout
 * `[locale]` y la marca como no indexable.
 *
 * El layout `[locale]` declara el canonical de la portada y las páginas que no
 * declaran el suyo lo heredan: sin esto, /es/login se anunciaba a sí misma como
 * `canonical=https://sticklive.eu/es` y Google la trataba como una alternativa
 * de la home.
 *
 * `alternates` va deliberadamente vacío (y no con un canonical propio) porque
 * un layout cubre varias hojas de su rama (p. ej. /premium/success y
 * /premium/error): un canonical fijo mentiría sobre la otra. Son páginas
 * privadas y `noindex`: no hay URL que consolidar. Estas páginas son
 * componentes de cliente, así que la metadata vive en el `layout.tsx` del
 * segmento (un page de cliente no puede exportarla).
 */
export function privateMetadata(): Metadata {
  return {
    alternates: {},
    robots: { index: false, follow: false },
  };
}

/**
 * Metadata de una ficha cuando la API falla al generarla (SEO-06, F1-10).
 *
 * Antes el `catch` devolvía solo `alternates` y la ficha heredaba el título y
 * la descripción de la home. Ahora:
 * - 404 real de la API: la ficha no existe (la página responde 404 con
 *   `notFound()`), metadata mínima y `noindex`.
 * - Cualquier otro fallo se propaga: la respuesta es 5xx y Google reintenta en
 *   vez de indexar un 200 con metadata ajena o de desindexar una ficha buena
 *   por un fallo temporal.
 */
export function metadataOnError(err: unknown, alternates: Metadata['alternates']): Metadata {
  if (isApiNotFound(err)) {
    return { alternates, robots: { index: false, follow: false } };
  }
  throw err;
}

/**
 * Ruta canónica de la ficha de competición.
 *
 * Por retrocompatibilidad el `[id]` de `/competitions/[id]` puede ser el id de
 * una TEMPORADA (enlaces antiguos): la ficha se sirve igual, así que quedaban
 * dos URLs con el mismo contenido y cada una declarándose canónica de sí misma
 * → "Duplicada: Google ha elegido una versión canónica diferente a la del
 * usuario" en Search Console. Cuando el id pedido no es el de la competición,
 * la canónica es la de la competición.
 */
export function competitionCanonicalPath(
  requestedId: string,
  competitionId?: string | null,
  competitionSlug?: string | null,
): string {
  // Plan A de URLs legibles: si la competición tiene slug, esa es la canónica.
  if (competitionId && isCompetitionSlug(competitionSlug)) return `/competitions/${competitionSlug}`;
  const id = competitionId && competitionId !== requestedId ? competitionId : requestedId;
  return `/competitions/${id}`;
}

// ─── Open Graph / Twitter ──────────────────────────────────────────────────────

/** Imagen social por defecto (1200×630, < 300 KB) servida desde /public. */
export const OG_IMAGE = {
  path: '/og-image-v2.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Stick Live — resultados de hockey patines en directo',
} as const;

/** Mapea el locale de la app al formato og:locale (idioma_PAÍS). */
const OG_LOCALE: Record<Locale, string> = {
  es: 'es_ES', ca: 'ca_ES', en: 'en_US', pt: 'pt_PT', fr: 'fr_FR', it: 'it_IT',
};

/**
 * Token de versión corto y determinista para la URL de una imagen social
 * dinámica (#274). Hash FNV-1a de 32 bits en base 36 (JS puro, sin dependencias).
 *
 * Se deriva del estado/marcador del partido (que va en el título OG, p. ej.
 * "CPC 2-2 LUB"): cambia en cada gol y al pasar de programado a en directo, de
 * modo que los scrapers (WhatsApp/Meta/X) piden una URL nueva en vez de
 * reutilizar su copia cacheada. Al ser determinista, la misma URL se comparte
 * entre peticiones del mismo estado (no rompe la caché del CDN entre visitas).
 */
export function socialImageVersion(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // Math.imul mantiene la aritmética en 32 bits sin desbordar el Number.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * URL absoluta de la imagen social dinámica de una ruta (opengraph-image /
 * twitter-image) con el token de versión en `?v=`.
 *
 * El `path` puede llevar query (p. ej. `/competitions/x?season=y` en #279): la
 * imagen es un fichero fijo y no admite query, así que la descartamos solo aquí
 * (la URL de la página sigue conservando `?season=`). Sin esto se generarían
 * URLs rotas tipo `/competitions/x?season=y/opengraph-image`.
 */
export function socialImageUrl(
  locale: Locale,
  path: string,
  file: 'opengraph-image' | 'twitter-image',
  version: string,
): string {
  const cleanPath = path.split(/[?#]/)[0] ?? '';
  const clean = cleanPath === '/' ? '' : cleanPath;
  return `${SITE_URL}/${locale}${clean}/${file}?v=${version}`;
}

/**
 * URL absoluta SIN prefijo de idioma (#280). Se incrusta como texto en la
 * imagen de alineación: el receptor la abre sin locale y el middleware negocia
 * su idioma (#277). El receptor no hereda el idioma de quien comparte.
 */
export function localeLessUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Sufijos de title por tipo de ficha (F3-3, §9.2). Se mantienen cortos para no
 * pasar de ~65 caracteres con nombres reales.
 */
const TITLE_COPY: Record<
  Locale,
  { competitionResults: string; competitionKnockout: string; competitionCalendar: string; team: string; playerWithTeam: string; playerAlone: string }
> = {
  es: {
    competitionResults: 'clasificación y resultados', competitionKnockout: 'cuadro y resultados', competitionCalendar: 'calendario',
    team: 'calendario, resultados y plantilla', playerWithTeam: 'estadísticas con', playerAlone: 'estadísticas',
  },
  ca: {
    competitionResults: 'classificació i resultats', competitionKnockout: 'quadre i resultats', competitionCalendar: 'calendari',
    team: 'calendari, resultats i plantilla', playerWithTeam: 'estadístiques amb', playerAlone: 'estadístiques',
  },
  en: {
    competitionResults: 'standings and results', competitionKnockout: 'bracket and results', competitionCalendar: 'fixtures',
    team: 'fixtures, results and squad', playerWithTeam: 'stats with', playerAlone: 'stats',
  },
  pt: {
    competitionResults: 'classificação e resultados', competitionKnockout: 'quadro e resultados', competitionCalendar: 'calendário',
    team: 'calendário, resultados e plantel', playerWithTeam: 'estatísticas com', playerAlone: 'estatísticas',
  },
  fr: {
    competitionResults: 'classement et résultats', competitionKnockout: 'tableau et résultats', competitionCalendar: 'calendrier',
    team: 'calendrier, résultats et effectif', playerWithTeam: 'statistiques avec', playerAlone: 'statistiques',
  },
  it: {
    competitionResults: 'classifica e risultati', competitionKnockout: 'tabellone e risultati', competitionCalendar: 'calendario',
    team: 'calendario, risultati e rosa', playerWithTeam: 'statistiche con', playerAlone: 'statistiche',
  },
};

/** Title de competición: clasificación (o cuadro en una copa) si hay partidos jugados; si no, calendario. */
export function competitionMetaTitle(opts: {
  locale: Locale;
  competitionName: string;
  seasonName?: string | null;
  hasPlayed: boolean;
  /** Copa a eliminatorias (final four, cuadro): no tiene clasificación. */
  knockout?: boolean;
}): string {
  const copy = TITLE_COPY[opts.locale] ?? TITLE_COPY.en;
  const season = opts.seasonName?.trim();
  const suffix = !opts.hasPlayed ? copy.competitionCalendar
    : opts.knockout ? copy.competitionKnockout : copy.competitionResults;
  return `${opts.competitionName}${season ? ` ${season}` : ''}: ${suffix} | Stick Live`;
}

/** Title de equipo club. `section` desambigua género/categoría/filial (F3-4). */
export function teamMetaTitle(opts: {
  locale: Locale;
  name: string;
  /** Etiqueta de sección ya localizada: "Femenina · Sub-19", "Filial B"… */
  section?: string | null;
}): string {
  const copy = TITLE_COPY[opts.locale] ?? TITLE_COPY.en;
  return `${teamQualifiedName(opts.name, opts.section)}: ${copy.team} | Stick Live`;
}

/** Title de jugador: incluye el equipo actual si se conoce. */
export function playerMetaTitle(opts: {
  locale: Locale;
  name: string;
  teamName?: string | null;
}): string {
  const copy = TITLE_COPY[opts.locale] ?? TITLE_COPY.en;
  const stats = opts.teamName ? `${copy.playerWithTeam} ${opts.teamName}` : copy.playerAlone;
  return `${opts.name}: ${stats} | Stick Live`;
}

/** Fecha corta del partido en la zona de Madrid (para title/description). */
export function matchDateLabel(
  scheduledAt: string | null | undefined,
  locale: Locale,
): string {
  if (!scheduledAt) return '';
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Madrid',
  }).format(date);
}

export interface MatchMetaInput {
  locale: Locale;
  home: string;
  away: string;
  status: string;
  score?: { home: number | null; away: number | null } | null;
  scheduledAt?: string | null;
}

/**
 * Title de una ficha de partido (F3-3, §9).
 *
 * Reglas: fecha siempre (desambigua ida/vuelta y cruces entre competiciones);
 * marcador solo si está terminado y ambos goles son no nulos (en directo el
 * title se quedaría desactualizado y Google lo cachearía).
 */
export function matchMetaTitle({ locale, home, away, status, score, scheduledAt }: MatchMetaInput): string {
  const date = matchDateLabel(scheduledAt, locale);
  const finishedScore =
    status === 'finished' && score?.home != null && score?.away != null
      ? `${score.home}-${score.away} `
      : '';
  const core = finishedScore ? `${home} ${finishedScore}${away}` : `${home} - ${away}`;
  return `${core}${date ? `, ${date}` : ''} | Stick Live`;
}

const FINISHED_DESC: Record<Locale, (home: string, away: string, score: string) => string> = {
  es: (h, a, s) => `Resultado final del ${h} - ${a}${s ? ` (${s})` : ''}: goles, alineaciones y estadísticas de hockey patines.`,
  ca: (h, a, s) => `Resultat final del ${h} - ${a}${s ? ` (${s})` : ''}: gols, alineacions i estadístiques d'hoquei patins.`,
  en: (h, a, s) => `Final result of ${h} vs ${a}${s ? ` (${s})` : ''}: goals, lineups and rink hockey stats.`,
  pt: (h, a, s) => `Resultado final do ${h} - ${a}${s ? ` (${s})` : ''}: golos, onzes e estatísticas de hóquei em patins.`,
  fr: (h, a, s) => `Résultat final du ${h} - ${a}${s ? ` (${s})` : ''} : buts, compositions et statistiques de rink hockey.`,
  it: (h, a, s) => `Risultato finale di ${h} - ${a}${s ? ` (${s})` : ''}: gol, formazioni e statistiche di hockey su pista.`,
};

const LIVE_DESC: Record<Locale, (home: string, away: string) => string> = {
  es: (h, a) => `${h} - ${a}: resultado en directo, goles, alineaciones y estadísticas de hockey patines.`,
  ca: (h, a) => `${h} - ${a}: resultat en directe, gols, alineacions i estadístiques d'hoquei patins.`,
  en: (h, a) => `${h} vs ${a}: live score, goals, lineups and rink hockey stats.`,
  pt: (h, a) => `${h} - ${a}: resultado em direto, golos, onzes e estatísticas de hóquei em patins.`,
  fr: (h, a) => `${h} - ${a} : score en direct, buts, compositions et statistiques de rink hockey.`,
  it: (h, a) => `${h} - ${a}: risultato in diretta, gol, formazioni e statistiche di hockey su pista.`,
};

const UPCOMING_DESC: Record<Locale, (home: string, away: string) => string> = {
  es: (h, a) => `${h} - ${a}: previa, hora, alineaciones y estadísticas del partido de hockey patines.`,
  ca: (h, a) => `${h} - ${a}: prèvia, hora, alineacions i estadístiques del partit d'hoquei patins.`,
  en: (h, a) => `${h} vs ${a}: preview, time, lineups and rink hockey stats.`,
  pt: (h, a) => `${h} - ${a}: antevisão, hora, onzes e estatísticas do jogo de hóquei em patins.`,
  fr: (h, a) => `${h} - ${a} : avant-match, horaire, compositions et statistiques de rink hockey.`,
  it: (h, a) => `${h} - ${a}: preview, orario, formazioni e statistiche di hockey su pista.`,
};

const POSTPONED_DESC: Record<Locale, (home: string, away: string) => string> = {
  es: (h, a) => `${h} - ${a}: partido aplazado de hockey patines.`,
  ca: (h, a) => `${h} - ${a}: partit ajornat d'hoquei patins.`,
  en: (h, a) => `${h} vs ${a}: postponed rink hockey match.`,
  pt: (h, a) => `${h} - ${a}: jogo adiado de hóquei em patins.`,
  fr: (h, a) => `${h} - ${a} : match de rink hockey reporté.`,
  it: (h, a) => `${h} - ${a}: partita di hockey su pista rinviata.`,
};

const CANCELLED_DESC: Record<Locale, (home: string, away: string) => string> = {
  es: (h, a) => `${h} - ${a}: partido cancelado de hockey patines.`,
  ca: (h, a) => `${h} - ${a}: partit cancel·lat d'hoquei patins.`,
  en: (h, a) => `${h} vs ${a}: cancelled rink hockey match.`,
  pt: (h, a) => `${h} - ${a}: jogo cancelado de hóquei em patins.`,
  fr: (h, a) => `${h} - ${a} : match de rink hockey annulé.`,
  it: (h, a) => `${h} - ${a}: partita di hockey su pista annullata.`,
};

/**
 * Description de una ficha de partido según su estado (F3-3, §9).
 *
 * Nunca dice «en directo» en un partido terminado o futuro: era el texto de
 * todas las fichas y Google lo cacheaba igual para un 0-0 de hace un mes.
 */
export function matchMetaDescription({
  locale,
  home,
  away,
  status,
  score,
}: MatchMetaInput): string {
  const lang = FINISHED_DESC[locale] ? locale : 'en';
  if (status === 'finished') {
    const s = score?.home != null && score?.away != null ? `${score.home}-${score.away}` : '';
    return FINISHED_DESC[lang](home, away, s);
  }
  if (status === 'live') return LIVE_DESC[lang](home, away);
  if (status === 'postponed') return POSTPONED_DESC[lang](home, away);
  if (status === 'cancelled') return CANCELLED_DESC[lang](home, away);
  return UPCOMING_DESC[lang](home, away);
}

/**
 * `BreadcrumbList` de schema.org (F5-6).
 *
 * Los `path` van sin prefijo de idioma; el builder añade `SITE_URL` y el locale
 * para que el `item` sea absoluto, como exige Google.
 */
export function breadcrumbJsonLd(
  locale: Locale,
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}/${locale}${item.path === '/' ? '' : item.path}`,
    })),
  };
}

/**
 * Construye los bloques openGraph + twitter (Metadata de Next) optimizados para
 * compartir en WhatsApp/Twitter/etc. Centralizado para que todas las páginas
 * usen el mismo formato (tarjeta grande 1.91:1, imagen segura, dimensiones).
 *
 * `title` debe ser corto (< 60 car.) y SIN el sufijo de marca para no cortarse.
 */
export function socialMeta(opts: {
  locale: Locale;
  path?: string;
  title: string;
  description: string;
  type?: 'website' | 'article' | 'profile';
  image?: { url: string; width: number; height: number; type?: string; alt?: string };
  /** La imagen la genera un fichero opengraph-image/twitter-image (OG dinámico). */
  dynamicImage?: boolean;
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { locale, path = '', title, description, type = 'website' } = opts;
  const url = `${SITE_URL}/${locale}${path === '/' ? '' : path}`;

  // Con imagen dinámica (opengraph-image.tsx + twitter-image.tsx) fijamos las
  // URLs a mano para incluir el token de versión (#274): la URL que Next genera
  // por defecto lleva un hash de build constante, así que quien la cachea
  // (WhatsApp/Meta/X) seguiría viendo el marcador del primer scrape. El token se
  // deriva del estado/marcador incrustado en el título OG.
  if (opts.dynamicImage) {
    const version = socialImageVersion(`${title}|${description}`);
    return {
      openGraph: {
        type,
        url,
        siteName: 'Stick Live',
        locale: OG_LOCALE[locale],
        title,
        description,
        images: [{
          url: socialImageUrl(locale, path, 'opengraph-image', version),
          width: OG_IMAGE.width,
          height: OG_IMAGE.height,
          type: OG_IMAGE.type,
          alt: title,
        }],
      },
      // #273: sin este bloque, X/Twitter heredaba el título/descripción
      // genéricos del layout (la imagen sí era la del partido). La card debe
      // llevar los datos del partido igual que openGraph.
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [socialImageUrl(locale, path, 'twitter-image', version)],
      },
    };
  }
  const img = opts.image
    ? opts.image
    : { url: `${SITE_URL}${OG_IMAGE.path}`, width: OG_IMAGE.width, height: OG_IMAGE.height, type: OG_IMAGE.type, alt: OG_IMAGE.alt };
  const imgUrl = img.url.startsWith('http') ? img.url : `${SITE_URL}${img.url}`;

  return {
    openGraph: {
      type,
      url,
      siteName: 'Stick Live',
      locale: OG_LOCALE[locale],
      title,
      description,
      images: [{
        url: imgUrl,
        secureUrl: imgUrl,
        width: img.width,
        height: img.height,
        type: img.type ?? 'image/png',
        alt: img.alt ?? title,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imgUrl],
    },
  };
}

// ─── Structured data / JSON-LD (#349) ─────────────────────────────────────────

const SITE_NAME = 'Stick Live';
const SPORT = 'Roller Hockey';

/**
 * WebSite + Organization a nivel de layout (#349): da marca en la SERP
 * (knowledge panel / sitelinks). Los builders son puros para poder testearlos y
 * se renderizan con `<JsonLd>` (que escapa el JSON).
 */
export function siteJsonLd(locale: Locale): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL, inLanguage: locale },
      { '@type': 'Organization', name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon-512.png` },
    ],
  };
}

/** SportsLeague + SportsSeason de una ficha de competición (#349). */
export function competitionJsonLd(opts: {
  leagueName: string;
  leagueUrl: string;
  seasonName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  country?: string | null;
}): Record<string, unknown> {
  const league: Record<string, unknown> = {
    '@type': 'SportsLeague',
    name: opts.leagueName,
    url: opts.leagueUrl,
    sport: SPORT,
  };
  if (opts.country) league['areaServed'] = opts.country;

  const season: Record<string, unknown> = {
    '@type': 'SportsSeason',
    name: opts.seasonName ? `${opts.leagueName} ${opts.seasonName}` : opts.leagueName,
    sport: SPORT,
  };
  if (opts.startDate) season['startDate'] = opts.startDate;
  if (opts.endDate) season['endDate'] = opts.endDate;

  return { '@context': 'https://schema.org', '@graph': [league, season] };
}

/** ItemList del listado de competiciones (#349). */
/**
 * `SportsEvent` de una ficha de partido (F3-6, §11).
 *
 * Incluye `url`, `homeTeam` y `awayTeam` además de `competitor`. No añade
 * `superEvent`: la API no expone el nombre de la temporada y no se inventa.
 * Tampoco pone `location` si no hay sede (hoy es nula en todos los partidos).
 */
export function matchJsonLd(opts: {
  locale: Locale;
  id: string;
  home: { id?: string | null; name: string };
  away: { id?: string | null; name: string };
  scheduledAt?: string | null;
  status: string;
  venue?: { name?: string | null; city?: string | null } | null;
}): Record<string, unknown> {
  const team = (side: { id?: string | null; name: string }) => ({
    '@type': 'SportsTeam',
    name: side.name,
    ...(side.id ? { url: `${SITE_URL}/${opts.locale}/teams/${side.id}` } : {}),
  });
  const eventStatus =
    opts.status === 'finished'
      ? undefined
      : opts.status === 'postponed'
        ? 'https://schema.org/EventPostponed'
        : opts.status === 'cancelled'
          ? 'https://schema.org/EventCancelled'
          : 'https://schema.org/EventScheduled';

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${opts.home.name} vs ${opts.away.name}`,
    sport: 'Roller Hockey',
    ...(opts.scheduledAt ? { startDate: opts.scheduledAt } : {}),
    ...(eventStatus ? { eventStatus } : {}),
    url: `${SITE_URL}/${opts.locale}/matches/${opts.id}`,
    ...(opts.venue?.name
      ? { location: { '@type': 'Place', name: opts.venue.name, ...(opts.venue.city ? { address: opts.venue.city } : {}) } }
      : {}),
    homeTeam: team(opts.home),
    awayTeam: team(opts.away),
    competitor: [team(opts.home), team(opts.away)],
  };
}

/** `SportsTeam` de una ficha de equipo, con `memberOf` de su liga actual (F3-6). */
export function teamJsonLd(opts: {
  locale: Locale;
  id: string;
  name: string;
  city?: string | null;
  logoUrl: string;
  competitionId?: string | null;
  competitionSlug?: string | null;
  competitionName?: string | null;
  /** Club canónico (Plan B1): se declara como `parentOrganization`. */
  clubSlug?: string | null;
  clubName?: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: opts.name,
    sport: 'Roller Hockey',
    url: `${SITE_URL}/${opts.locale}/teams/${opts.id}`,
    logo: opts.logoUrl,
    ...(opts.city ? { location: { '@type': 'Place', name: opts.city } } : {}),
    ...(opts.competitionId && opts.competitionName
      ? {
          memberOf: {
            '@type': 'SportsLeague',
            name: opts.competitionName,
            url: `${SITE_URL}/${opts.locale}${competitionCanonicalPath(opts.competitionId, opts.competitionId, opts.competitionSlug)}`,
          },
        }
      : {}),
    ...(opts.clubSlug && opts.clubName
      ? {
          parentOrganization: {
            '@type': 'SportsOrganization',
            '@id': `${SITE_URL}/clubs/${opts.clubSlug}#club`,
            name: opts.clubName,
            url: `${SITE_URL}/${opts.locale}/clubs/${opts.clubSlug}`,
          },
        }
      : {}),
  };
}

/** `Person` de una ficha de jugador (F3-6). */
export function playerJsonLd(opts: {
  locale: Locale;
  id: string;
  name: string;
  photoUrl?: string | null;
  teamName?: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: opts.name,
    url: `${SITE_URL}/${opts.locale}/players/${opts.id}`,
    ...(opts.photoUrl ? { image: opts.photoUrl } : {}),
    ...(opts.teamName ? { memberOf: { '@type': 'SportsTeam', name: opts.teamName } } : {}),
    jobTitle: 'Roller Hockey Player',
  };
}

export function competitionsListJsonLd(
  items: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  };
}
