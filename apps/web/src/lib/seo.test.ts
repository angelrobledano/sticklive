import { describe, it, expect } from 'vitest';
import {
  socialMeta, socialImageVersion, socialImageUrl, localeLessUrl, SITE_URL,
  siteJsonLd, competitionJsonLd, competitionsListJsonLd, privateMetadata,
  competitionCanonicalPath,
} from './seo';

/**
 * #273: al compartir una ficha de partido en X/Twitter, la tarjeta debe usar
 * el título/descripción del partido (no los genéricos de portada).
 * #274: la URL de la imagen social lleva un token de versión dependiente del
 * estado/marcador para que los scrapers pidan una URL nueva en cada cambio.
 */
describe('socialImageVersion (#274)', () => {
  it('es determinista para el mismo estado', () => {
    expect(socialImageVersion('CPC 2-2 LUB|desc')).toBe(
      socialImageVersion('CPC 2-2 LUB|desc'),
    );
  });

  it('cambia cuando cambia el marcador o el estado', () => {
    expect(socialImageVersion('CPC 2-2 LUB')).not.toBe(
      socialImageVersion('CPC 3-2 LUB'),
    );
    // programado (" - ") vs en directo/finalizado (" 0-0 ")
    expect(socialImageVersion('CPC - LUB')).not.toBe(
      socialImageVersion('CPC 0-0 LUB'),
    );
  });

  it('devuelve un token seguro para URL (solo [0-9a-z])', () => {
    expect(socialImageVersion('CPC 2-2 LUB · EN DIRECTO')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('socialImageUrl (#274)', () => {
  it('construye la URL absoluta con el token de versión', () => {
    expect(socialImageUrl('es', '/matches/abc', 'opengraph-image', 'v123')).toBe(
      `${SITE_URL}/es/matches/abc/opengraph-image?v=v123`,
    );
  });

  it('maneja la raíz sin doble barra', () => {
    expect(socialImageUrl('en', '/', 'twitter-image', 'v123')).toBe(
      `${SITE_URL}/en/twitter-image?v=v123`,
    );
  });
});

describe('socialMeta (#273, #274)', () => {
  const base = {
    locale: 'es' as const,
    path: '/matches/abc',
    title: 'CPC 2-2 LUB',
    description: 'Resultado del CPC - LUB en Stick Live.',
  };

  it('con imagen dinámica incluye la twitter card con los datos del partido (#273)', () => {
    const meta = socialMeta({ ...base, dynamicImage: true });
    expect(meta.twitter).toMatchObject({
      card: 'summary_large_image',
      title: base.title,
      description: base.description,
    });
  });

  it('con imagen dinámica versiona las URLs de imagen por estado (#274)', () => {
    const meta = socialMeta({ ...base, dynamicImage: true });
    const version = socialImageVersion(`${base.title}|${base.description}`);
    const ogImages = meta.openGraph?.images as Array<{ url: string }>;
    expect(ogImages[0]?.url).toBe(
      socialImageUrl('es', base.path, 'opengraph-image', version),
    );
    expect(meta.twitter?.images).toEqual([
      socialImageUrl('es', base.path, 'twitter-image', version),
    ]);
  });

  it('el token de la imagen cambia al cambiar el marcador (#274)', () => {
    const a = socialMeta({ ...base, dynamicImage: true });
    const b = socialMeta({ ...base, title: 'CPC 3-2 LUB', dynamicImage: true });
    const urlA = (a.openGraph?.images as Array<{ url: string }>)[0]?.url;
    const urlB = (b.openGraph?.images as Array<{ url: string }>)[0]?.url;
    expect(urlA).not.toBe(urlB);
  });

  it('sin imagen dinámica mantiene la imagen estática por defecto (sin regresión)', () => {
    const meta = socialMeta({ ...base });
    const ogImages = meta.openGraph?.images as Array<{ url: string }>;
    expect(ogImages[0]?.url).toBe(`${SITE_URL}/og-image-v2.png`);
    expect(meta.twitter?.images).toEqual([`${SITE_URL}/og-image-v2.png`]);
  });

  // #278/#279: la imagen de competición lleva su propia ruta, pero el path de la
  // página puede incluir `?season=`. La imagen vive en un fichero fijo: la query
  // debe descartarse solo para la imagen, no para la URL canónica/OG de la página.
  it('con temporada mantiene ?season en la URL de la página y lo quita de la imagen', () => {
    const title = 'Liga 2025/26';
    const meta = socialMeta({
      locale: 'es',
      path: '/competitions/c1?season=s1',
      title,
      description: 'desc',
      dynamicImage: true,
    });
    expect(meta.openGraph?.url).toBe(`${SITE_URL}/es/competitions/c1?season=s1`);
    const version = socialImageVersion(`${title}|desc`);
    const ogImages = meta.openGraph?.images as Array<{ url: string }>;
    expect(ogImages[0]?.url).toBe(
      socialImageUrl('es', '/competitions/c1?season=s1', 'opengraph-image', version),
    );
    expect(ogImages[0]?.url).toBe(
      `${SITE_URL}/es/competitions/c1/opengraph-image?v=${version}`,
    );
    expect(meta.twitter?.images).toEqual([
      `${SITE_URL}/es/competitions/c1/twitter-image?v=${version}`,
    ]);
  });
});

// #367: el og:type debe ser coherente con el tipo de entidad. Por defecto
// 'website' (home, competiciones, equipos) y 'profile' para fichas de persona
// (jugador); nunca el genérico 'article' que arrastraban las fichas.
describe('socialMeta og:type (#367)', () => {
  it('usa website por defecto', () => {
    const meta = socialMeta({ locale: 'es', title: 't', description: 'd' });
    expect((meta.openGraph as { type?: string } | undefined)?.type).toBe('website');
  });

  it('respeta el type explícito de perfil de jugador', () => {
    const meta = socialMeta({ locale: 'es', title: 't', description: 'd', type: 'profile' });
    expect((meta.openGraph as { type?: string } | undefined)?.type).toBe('profile');
  });
});

// #278: cada entidad debe tener su imagen social en su propia ruta.
describe('socialImageUrl por entidad (#278)', () => {
  it.each([
    ['/teams/t1', `${SITE_URL}/es/teams/t1/opengraph-image?v=v1`],
    ['/players/p1', `${SITE_URL}/es/players/p1/opengraph-image?v=v1`],
    ['/competitions/c1', `${SITE_URL}/es/competitions/c1/opengraph-image?v=v1`],
  ])('construye la imagen OG de %s', (path, expected) => {
    expect(socialImageUrl('es', path, 'opengraph-image', 'v1')).toBe(expected);
  });
});

// #280: URL sin prefijo de idioma para incrustar en la imagen de alineación. El
// receptor la abre y el middleware negocia su idioma (#277).
describe('localeLessUrl (#280)', () => {
  it('construye la URL absoluta sin prefijo de idioma', () => {
    expect(localeLessUrl('/matches/abc')).toBe(`${SITE_URL}/matches/abc`);
  });

  it('acepta rutas sin barra inicial', () => {
    expect(localeLessUrl('matches/abc')).toBe(`${SITE_URL}/matches/abc`);
  });
});

// #349: structured data ausente en home/lista/ficha de competición.
describe('siteJsonLd (#349)', () => {
  it('emite WebSite + Organization con la URL del sitio y el idioma', () => {
    const ld = siteJsonLd('es');
    const graph = ld['@graph'] as Array<Record<string, unknown>>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(graph.map((n) => n['@type'])).toEqual(['WebSite', 'Organization']);
    expect(graph[0]).toMatchObject({ name: 'Stick Live', url: SITE_URL, inLanguage: 'es' });
    expect(graph[1]).toMatchObject({ name: 'Stick Live', url: SITE_URL });
    expect(String(graph[1]?.['logo'])).toBe(`${SITE_URL}/icon-512.png`);
  });
});

describe('competitionJsonLd (#349)', () => {
  const opts = {
    leagueName: 'OK Liga',
    leagueUrl: `${SITE_URL}/es/competitions/c1`,
    seasonName: '2025/26',
    startDate: '2025-09-06T00:00:00.000Z',
    endDate: '2026-05-30T00:00:00.000Z',
  };

  it('emite SportsLeague + SportsSeason en un @graph', () => {
    const ld = competitionJsonLd(opts);
    const graph = ld['@graph'] as Array<Record<string, unknown>>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(graph.map((n) => n['@type'])).toEqual(['SportsLeague', 'SportsSeason']);
  });

  it('la liga lleva nombre, url y deporte', () => {
    const league = (competitionJsonLd(opts)['@graph'] as Array<Record<string, unknown>>)[0]!;
    expect(league).toMatchObject({
      '@type': 'SportsLeague',
      name: 'OK Liga',
      url: opts.leagueUrl,
      sport: 'Roller Hockey',
    });
  });

  it('la temporada lleva nombre compuesto y fechas; omite las ausentes', () => {
    const season = (competitionJsonLd(opts)['@graph'] as Array<Record<string, unknown>>)[1]!;
    expect(season).toMatchObject({
      '@type': 'SportsSeason',
      name: 'OK Liga 2025/26',
      startDate: opts.startDate,
      endDate: opts.endDate,
      sport: 'Roller Hockey',
    });
    const noDates = (competitionJsonLd({ leagueName: 'Copa', leagueUrl: opts.leagueUrl })['@graph'] as Array<Record<string, unknown>>)[1]!;
    expect('startDate' in noDates).toBe(false);
    expect('endDate' in noDates).toBe(false);
    expect(noDates['name']).toBe('Copa');
  });
});

describe('competitionsListJsonLd (#349)', () => {
  it('construye un ItemList con posiciones 1-based y URLs absolutas', () => {
    const ld = competitionsListJsonLd([
      { name: 'OK Liga', url: `${SITE_URL}/es/competitions/c1` },
      { name: 'Copa del Rey', url: `${SITE_URL}/es/competitions/c2` },
    ]);
    expect(ld).toMatchObject({ '@context': 'https://schema.org', '@type': 'ItemList' });
    expect(ld['itemListElement']).toEqual([
      { '@type': 'ListItem', position: 1, name: 'OK Liga', url: `${SITE_URL}/es/competitions/c1` },
      { '@type': 'ListItem', position: 2, name: 'Copa del Rey', url: `${SITE_URL}/es/competitions/c2` },
    ]);
  });

  it('con lista vacía devuelve un ItemList sin elementos', () => {
    expect(competitionsListJsonLd([])['itemListElement']).toEqual([]);
  });
});

// El layout `[locale]` define el canonical de la portada y las páginas que no
// definen el suyo lo heredaban: /es/login declaraba ser https://sticklive.eu/es
// y Google la trataba como alternativa de la home.
describe('privateMetadata', () => {
  it('no declara canonical, para descartar el de la portada heredado', () => {
    const meta = privateMetadata();
    expect(meta.alternates).toEqual({});
    expect(meta.alternates?.canonical).toBeUndefined();
  });

  it('marca la página como no indexable', () => {
    expect(privateMetadata().robots).toEqual({ index: false, follow: false });
  });
});

// GSC (16-oct-2026), fila "Duplicada: Google ha elegido una versión canónica
// diferente a la del usuario": `/competitions/<idDeTemporada>` (retrocompat)
// servía el mismo contenido que `/competitions/<idDeCompetición>` y ambas se
// declaraban canónicas de sí mismas.
describe('competitionCanonicalPath', () => {
  it('con un id de competición devuelve la misma ruta', () => {
    expect(competitionCanonicalPath('c1', 'c1')).toBe('/competitions/c1');
  });

  it('con un id de temporada apunta a la competición', () => {
    expect(competitionCanonicalPath('season-1', 'c1')).toBe('/competitions/c1');
  });

  it('sin competitionId en el payload conserva la ruta pedida', () => {
    expect(competitionCanonicalPath('season-1', null)).toBe('/competitions/season-1');
    expect(competitionCanonicalPath('season-1', undefined)).toBe('/competitions/season-1');
  });
});
