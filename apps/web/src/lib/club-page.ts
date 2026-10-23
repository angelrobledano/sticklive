import type { ClubDetail } from '@/lib/api/types';
import type { Locale } from '@/lib/locales';
import { SITE_URL } from '@/lib/seo';
import { clubName } from '@/lib/names';

/**
 * Textos y structured data de la ficha de club (Plan B1). Lógica pura, testeada
 * aparte de la página.
 */

interface ClubCopy {
  teams: string;
  recent: string;
  upcoming: string;
  teamsCount: (n: number) => string;
  position: (n: number) => string;
  title: (name: string) => string;
  description: (name: string, teams: number) => string;
}

export const CLUB_COPY: Record<Locale, ClubCopy> = {
  es: {
    teams: 'Equipos del club', recent: 'Últimos resultados', upcoming: 'Próximos partidos',
    teamsCount: (n) => (n === 1 ? '1 equipo' : `${n} equipos`),
    position: (n) => `${n}º`,
    title: (n) => `${n}: equipos, resultados y calendario`,
    description: (n, t) => `${n}: ${t > 1 ? `sus ${t} equipos` : 'su equipo'}, últimos resultados y próximos partidos de hockey patines en Stick Live.`,
  },
  ca: {
    teams: 'Equips del club', recent: 'Últims resultats', upcoming: 'Propers partits',
    teamsCount: (n) => (n === 1 ? '1 equip' : `${n} equips`),
    position: (n) => `${n}è`,
    title: (n) => `${n}: equips, resultats i calendari`,
    description: (n, t) => `${n}: ${t > 1 ? `els seus ${t} equips` : 'el seu equip'}, últims resultats i propers partits d'hoquei patins a Stick Live.`,
  },
  en: {
    teams: 'Club teams', recent: 'Latest results', upcoming: 'Upcoming matches',
    teamsCount: (n) => (n === 1 ? '1 team' : `${n} teams`),
    position: (n) => `#${n}`,
    title: (n) => `${n}: teams, results and fixtures`,
    description: (n, t) => `${n}: ${t > 1 ? `its ${t} teams` : 'its team'}, latest results and upcoming rink hockey matches on Stick Live.`,
  },
  pt: {
    teams: 'Equipas do clube', recent: 'Últimos resultados', upcoming: 'Próximos jogos',
    teamsCount: (n) => (n === 1 ? '1 equipa' : `${n} equipas`),
    position: (n) => `${n}º`,
    title: (n) => `${n}: equipas, resultados e calendário`,
    description: (n, t) => `${n}: ${t > 1 ? `as suas ${t} equipas` : 'a sua equipa'}, últimos resultados e próximos jogos de hóquei em patins no Stick Live.`,
  },
  fr: {
    teams: 'Équipes du club', recent: 'Derniers résultats', upcoming: 'Prochains matchs',
    teamsCount: (n) => (n === 1 ? '1 équipe' : `${n} équipes`),
    position: (n) => (n === 1 ? '1er' : `${n}e`),
    title: (n) => `${n} : équipes, résultats et calendrier`,
    description: (n, t) => `${n} : ${t > 1 ? `ses ${t} équipes` : 'son équipe'}, derniers résultats et prochains matchs de rink hockey sur Stick Live.`,
  },
  it: {
    teams: 'Squadre del club', recent: 'Ultimi risultati', upcoming: 'Prossime partite',
    teamsCount: (n) => (n === 1 ? '1 squadra' : `${n} squadre`),
    position: (n) => `${n}º`,
    title: (n) => `${n}: squadre, risultati e calendario`,
    description: (n, t) => `${n}: ${t > 1 ? `le sue ${t} squadre` : 'la sua squadra'}, ultimi risultati e prossime partite di hockey su pista su Stick Live.`,
  },
};

export function clubMetaTitle(locale: Locale, name: string): string {
  return CLUB_COPY[locale].title(name);
}

/** `SportsOrganization` con sus equipos como `SportsTeam` (`parentOrganization` lo declara la ficha de equipo). */
export function clubJsonLd(locale: Locale, data: ClubDetail): Record<string, unknown> {
  const url = `${SITE_URL}/${locale}/clubs/${data.club.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsOrganization',
    '@id': `${SITE_URL}/clubs/${data.club.slug}#club`,
    name: clubName(data.club.name),
    url,
    sport: 'Roller Hockey',
    ...(data.club.city ? { location: { '@type': 'Place', name: data.club.city } } : {}),
    ...(data.teams.length > 0
      ? {
          subOrganization: data.teams.map((t) => ({
            '@type': 'SportsTeam',
            name: clubName(t.name),
            url: `${SITE_URL}/${locale}/teams/${t.id}`,
          })),
        }
      : {}),
  };
}
