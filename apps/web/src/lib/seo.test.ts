import { describe, it, expect } from 'vitest';
import {
  breadcrumbJsonLd,
  matchDateLabel, matchMetaDescription, matchMetaTitle,
  competitionMetaTitle, teamMetaTitle, playerMetaTitle,
  matchJsonLd, teamJsonLd, playerJsonLd,
  socialMeta, socialImageVersion, socialImageUrl, localeLessUrl, SITE_URL,
  siteJsonLd, competitionJsonLd, competitionsListJsonLd, privateMetadata,
  competitionCanonicalPath, localeAlternates,
} from './seo';

/**
 * #273: al compartir una ficha de partido en X/Twitter, la tarjeta debe usar
 * el título/descripción del partido (no los genéricos de portada).
 * #274: la URL de la imagen social lleva un token de versión dependiente del
 * estado/marcador para que los scrapers pidan una URL nueva en cada cambio.
 */
describe('breadcrumbJsonLd (F5-6)', () => {
  it('numera las migas y convierte las rutas en URLs absolutas con idioma', () => {
    const ld = breadcrumbJsonLd('es', [
      { name: 'Inicio', path: '/' },
      { name: 'Competiciones', path: '/competitions' },
      { name: 'OK Liga', path: '/competitions/c1' },
    ]);
    const items = ld['itemListElement'] as Array<Record<string, unknown>>;

    expect(ld['@type']).toBe('BreadcrumbList');
    expect(items[0]).toEqual({
      '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE_URL}/es`,
    });
    expect(items[2]).toEqual({
      '@type': 'ListItem', position: 3, name: 'OK Liga', item: `${SITE_URL}/es/competitions/c1`,
    });
  });
});

describe('localeAlternates (x-default español)', () => {
  it('usa el español como x-default sin cambiar el canonical de la URL', () => {
    const alternates = localeAlternates('en', '/teams/t1');
    const languages = (alternates?.languages ?? {}) as Record<string, string>;

    expect(alternates?.canonical).toBe(`${SITE_URL}/en/teams/t1`);
    expect(languages['x-default']).toBe(`${SITE_URL}/es/teams/t1`);
  });
});

describe('titles de competición, equipo y jugador (F3-3)', () => {
  it('competición: clasificación si hay jornadas jugadas; calendario si no', () => {
    expect(competitionMetaTitle({
      locale: 'es', competitionName: 'OK Liga', seasonName: '2026/27', hasPlayed: true,
    })).toBe('OK Liga 2026/27: clasificación y resultados | Stick Live');
    expect(competitionMetaTitle({
      locale: 'es', competitionName: 'OK Liga', seasonName: '2026/27', hasPlayed: false,
    })).toBe('OK Liga 2026/27: calendario | Stick Live');
  });

  it('copa a eliminatorias: cuadro en vez de clasificación', () => {
    expect(competitionMetaTitle({
      locale: 'es', competitionName: 'Supercopa', seasonName: '2026/27', hasPlayed: true, knockout: true,
    })).toBe('Supercopa 2026/27: cuadro y resultados | Stick Live');
    expect(competitionMetaTitle({
      locale: 'en', competitionName: 'Supercopa', hasPlayed: true, knockout: true,
    })).toBe('Supercopa: bracket and results | Stick Live');
  });

  it('competición sin temporada no deja un espacio doble', () => {
    expect(competitionMetaTitle({
      locale: 'es', competitionName: 'OK Liga', seasonName: null, hasPlayed: true,
    })).toBe('OK Liga: clasificación y resultados | Stick Live');
  });

  it('equipo y jugador incluyen el contexto pedido', () => {
    expect(teamMetaTitle({ locale: 'es', name: 'CP Tordera' }))
      .toBe('CP Tordera: calendario, resultados y plantilla | Stick Live');
    expect(teamMetaTitle({ locale: 'es', name: 'España', section: 'Femenina · Sub-19' }))
      .toBe('España (Femenina · Sub-19): calendario, resultados y plantilla | Stick Live');
    expect(teamMetaTitle({ locale: 'es', name: 'España Femenina', section: 'Femenina · Sub-19' }))
      .toBe('España Femenina (Sub-19): calendario, resultados y plantilla | Stick Live');
    expect(playerMetaTitle({ locale: 'es', name: 'Marc Castañer', teamName: 'CP Tordera' }))
      .toBe('Marc Castañer: estadísticas con CP Tordera | Stick Live');
    expect(playerMetaTitle({ locale: 'es', name: 'Marc Castañer' }))
      .toBe('Marc Castañer: estadísticas | Stick Live');
  });

  it('cambia el sufijo por idioma', () => {
    expect(teamMetaTitle({ locale: 'en', name: 'CP Tordera' }))
      .toBe('CP Tordera: fixtures, results and squad | Stick Live');
  });
});

describe('matchMetaTitle / matchMetaDescription (F3-3)', () => {
  const base = {
    locale: 'es' as const,
    home: 'Liceo',
    away: 'Reus',
    scheduledAt: '2026-10-12T16:15:00.000Z',
  };

  it('un partido terminado lleva marcador y fecha en el título', () => {
    const title = matchMetaTitle({ ...base, status: 'finished', score: { home: 2, away: 2 } });

    expect(title).toContain('Liceo 2-2 Reus');
    expect(title).toContain(matchDateLabel(base.scheduledAt, 'es'));
    expect(title.endsWith('| Stick Live')).toBe(true);
  });

  it('un partido en directo no lleva marcador (se quedaría desactualizado)', () => {
    const title = matchMetaTitle({ ...base, status: 'live', score: { home: 3, away: 1 } });

    expect(title).not.toContain('3-1');
    expect(title).toContain('Liceo - Reus');
  });

  it('un partido programado no lleva marcador y sí fecha', () => {
    const title = matchMetaTitle({ ...base, status: 'scheduled', score: { home: null, away: null } });

    expect(title).toContain('Liceo - Reus');
    expect(title).not.toContain('0-0');
    expect(title).toContain(matchDateLabel(base.scheduledAt, 'es'));
  });

  it('si falta el marcador de un terminado no inventa 0-0', () => {
    const title = matchMetaTitle({ ...base, status: 'finished', score: { home: null, away: null } });
    expect(title).not.toContain('0-0');
  });

  it('la descripción de un terminado no dice «en directo»', () => {
    const desc = matchMetaDescription({ ...base, status: 'finished', score: { home: 2, away: 2 } });
    expect(desc.toLowerCase()).not.toContain('directo');
    expect(desc).toContain('Liceo');
  });

  it('la descripción de un directo sí lo dice; la de un programado no', () => {
    expect(matchMetaDescription({ ...base, status: 'live', score: { home: 1, away: 0 } }).toLowerCase())
      .toContain('directo');
    expect(matchMetaDescription({ ...base, status: 'scheduled', score: { home: null, away: null } }).toLowerCase())
      .not.toContain('directo');
  });

  it('cambia el copy por idioma', () => {
    const en = matchMetaDescription({ ...base, locale: 'en', status: 'finished', score: { home: 2, away: 2 } });
    expect(en.toLowerCase()).toContain('final');
    expect(en.toLowerCase()).not.toContain('directo');
  });
});

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
  it('usa el slug de la competición cuando lo hay (Plan A)', () => {
    expect(competitionCanonicalPath('c1', 'c1', 'ok-liga')).toBe('/competitions/ok-liga');
    expect(competitionCanonicalPath('ok-liga', 'c1', 'ok-liga')).toBe('/competitions/ok-liga');
    expect(competitionCanonicalPath('c1', 'c1', 'Mal Slug')).toBe('/competitions/c1');
  });

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

describe('matchJsonLd (F3-6)', () => {
  const base = {
    locale: 'es' as const,
    id: 'm1',
    home: { id: 'h1', name: 'Liceo' },
    away: { id: 'a1', name: 'Reus' },
    scheduledAt: '2026-10-12T16:15:00.000Z',
  };

  it('incluye url, homeTeam, awayTeam y competitor', () => {
    const ld = matchJsonLd({ ...base, status: 'finished' });
    expect(ld['@type']).toBe('SportsEvent');
    expect(ld['url']).toBe(`${SITE_URL}/es/matches/m1`);
    expect(ld['homeTeam']).toEqual({ '@type': 'SportsTeam', name: 'Liceo', url: `${SITE_URL}/es/teams/h1` });
    expect(ld['awayTeam']).toEqual({ '@type': 'SportsTeam', name: 'Reus', url: `${SITE_URL}/es/teams/a1` });
    expect((ld['competitor'] as unknown[]).length).toBe(2);
  });

  it('omite eventStatus en terminado y lo pone en programado/directo', () => {
    expect(matchJsonLd({ ...base, status: 'finished' })).not.toHaveProperty('eventStatus');
    expect(matchJsonLd({ ...base, status: 'live' })['eventStatus']).toBe('https://schema.org/EventScheduled');
    expect(matchJsonLd({ ...base, status: 'postponed' })['eventStatus']).toBe('https://schema.org/EventPostponed');
  });

  it('no inventa location si no hay sede', () => {
    expect(matchJsonLd({ ...base, status: 'scheduled' })).not.toHaveProperty('location');
    const withVenue = matchJsonLd({ ...base, status: 'scheduled', venue: { name: 'Palau', city: 'Barcelona' } });
    expect(withVenue['location']).toEqual({ '@type': 'Place', name: 'Palau', address: 'Barcelona' });
  });
});

describe('teamJsonLd (F3-6)', () => {
  it('a�ade memberOf con la liga y omite location sin ciudad', () => {
    const ld = teamJsonLd({
      locale: 'es', id: 't1', name: 'CP Tordera', logoUrl: 'https://api/logo',
      competitionId: 'c1', competitionName: 'OK Liga',
    });
    expect(ld['memberOf']).toEqual({
      '@type': 'SportsLeague', name: 'OK Liga', url: `${SITE_URL}/es/competitions/c1`,
    });
    expect(ld).not.toHaveProperty('location');
    expect(ld['sport']).toBe('Roller Hockey');
  });

  it('incluye location solo si hay ciudad', () => {
    const ld = teamJsonLd({
      locale: 'es', id: 't1', name: 'CP Tordera', city: 'Tordera', logoUrl: 'https://api/logo',
    });
    expect(ld['location']).toEqual({ '@type': 'Place', name: 'Tordera' });
    expect(ld).not.toHaveProperty('memberOf');
  });
});

describe('playerJsonLd (F3-6)', () => {
  it('incluye imagen, equipo y url', () => {
    const ld = playerJsonLd({
      locale: 'es', id: 'p1', name: 'Marc Casta�er', photoUrl: 'https://api/photo', teamName: 'CP Tordera',
    });
    expect(ld['@type']).toBe('Person');
    expect(ld['url']).toBe(`${SITE_URL}/es/players/p1`);
    expect(ld['image']).toBe('https://api/photo');
    expect(ld['memberOf']).toEqual({ '@type': 'SportsTeam', name: 'CP Tordera' });
  });

  it('omite imagen y equipo si no existen', () => {
    const ld = playerJsonLd({ locale: 'es', id: 'p1', name: 'X' });
    expect(ld).not.toHaveProperty('image');
    expect(ld).not.toHaveProperty('memberOf');
  });
});
