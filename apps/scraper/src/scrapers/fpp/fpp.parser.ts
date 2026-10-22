/**
 * Parser puro de hp.fpp.pt (Federação de Patinagem de Portugal, hóquei em patins).
 *
 * La web de la FPP NO es sidgad: es un PHP propio renderizado en servidor.
 *   · /Competicao/{id}     calendario completo (todas las jornadas en una tabla
 *                          `table.calendario-hp`, cabeceras `h6.titulo-jornada`).
 *   · /Classificacao/{id}  clasificación (tabla con P J V E D GM GS DG).
 *   · /jogo/{id}           ficha (solo cuando el partido tiene acta; v2).
 *
 * Particularidades:
 *   · Cada FASE es un id distinto (playoff 1/4, 1/2 y final; cada ronda de la
 *     Taça). El catálogo (`fpp-catalog.ts`) agrupa varios ids en una competición.
 *   · Las horas son locales de Portugal continental (Europe/Lisbon).
 *   · Los cruces aún sin decidir llegan como "Vencedor Jogo 1557": no son equipos.
 *
 * Sin red ni BD: recibe HTML y devuelve filas crudas. Testeable con golden files.
 */
import * as cheerio from 'cheerio';

export interface FppCalendarRow {
  /** Nº de partido de la FPP dentro de la competición (estable desde que se publica). */
  numero: string;
  /** Cabecera de la jornada/ronda ("1ª Jornada", "1/4 Final", "Pré Eliminatória Norte"). */
  roundLabel: string;
  /** YYYY-MM-DD, o null si la fuente no la da. */
  date: string | null;
  /** HH:MM local, o null. */
  time: string | null;
  homeName: string;
  awayName: string;
  /** id de inscripción en la competición (/Equipa/{comp}/{id}); no siempre presente. */
  homeEquipaId: string | null;
  awayEquipaId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** id de la ficha (/jogo/{id}) cuando existe. */
  jogoId: string | null;
  /** Orden en el documento. */
  docIndex: number;
}

export interface FppStandingRow {
  position: number;
  name: string;
  equipaId: string | null;
  logoUrl: string | null;
  /** Id de club de la FPP (CLUBE_119.png → '119'), estable entre temporadas. */
  clubId: string | null;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** Espacios colapsados y recortados (la FPP deja espacios al final: "FC Porto "). */
export function cleanName(raw: string): string {
  return raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Vencedor Jogo 1557", "Vencido jogo 3", "A definir"… no son equipos. */
export function isPlaceholderTeam(name: string): boolean {
  return !name || /^(?:vencedor|vencido|perdedor)\b|^a definir$|^por definir$|^\d+º\s/i.test(cleanName(name));
}

function equipaIdOf(href: string | undefined): string | null {
  const m = /\/Equipa\/\d+\/(\d+)/i.exec(href ?? '');
  return m ? m[1]! : null;
}

function intOrNull(s: string): number | null {
  const t = s.trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/** Calendario de /Competicao/{id}. */
export function parseFppCalendar(html: string): FppCalendarRow[] {
  const $ = cheerio.load(html);
  const rows: FppCalendarRow[] = [];
  let roundLabel = '';
  let docIndex = 0;

  $('table.calendario-hp tr').each((_, tr) => {
    const $tr = $(tr);
    const head = $tr.find('h6.titulo-jornada');
    if (head.length > 0) {
      roundLabel = cleanName(head.text());
      return;
    }
    const numero = cleanName($tr.find('td.coluna-numero').text());
    if (!numero) return;

    // Fecha y hora van en la misma celda separadas por <br>.
    const dataCell = $tr.find('td.coluna-data').not('.coluna-numero').first().text();
    const date = /(\d{4}-\d{2}-\d{2})/.exec(dataCell)?.[1] ?? null;
    const time = /\b(\d{1,2}:\d{2})\b/.exec(dataCell)?.[1] ?? null;

    const teams = $tr.find('td.coluna-equipa');
    const home = teams.eq(0);
    const away = teams.eq(1);
    const homeName = cleanName(home.find('p').first().text());
    const awayName = cleanName(away.find('p').first().text());

    const res = /(\d+)\s*-\s*(\d+)/.exec($tr.find('td.coluna-resultado').text());
    const jogo = /\/jogo\/(\d+)/i.exec($tr.find('td.coluna-opcoes a').attr('href') ?? '');

    rows.push({
      numero,
      roundLabel,
      date,
      time: time ? time.padStart(5, '0') : null,
      homeName,
      awayName,
      homeEquipaId: equipaIdOf(home.find('a').attr('href')),
      awayEquipaId: equipaIdOf(away.find('a').attr('href')),
      homeScore: res ? Number(res[1]) : null,
      awayScore: res ? Number(res[2]) : null,
      jogoId: jogo ? jogo[1]! : null,
      docIndex: docIndex++,
    });
  });
  return rows;
}

/** Clasificación de /Classificacao/{id}. */
export function parseFppStandings(html: string): FppStandingRow[] {
  const $ = cheerio.load(html);
  const out: FppStandingRow[] = [];
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const pos = intOrNull($tr.find('td.classificacao').text());
    if (pos === null) return;
    const clube = $tr.find('td.clube');
    const name = cleanName(clube.find('p').last().text());
    if (!name) return;
    const logo = clube.find('img').attr('src') ?? null;
    const nums = $tr.find('td').not('.classificacao').not('.clube')
      .map((__, td) => intOrNull($(td).text())).get() as Array<number | null>;
    // P J V E D GM GS DG
    const [points, played, won, drawn, lost, gf, ga] = nums;
    out.push({
      position: pos,
      name,
      equipaId: equipaIdOf(clube.find('a').attr('href')),
      logoUrl: logo,
      clubId: /CLUBE_(\d+)\./i.exec(logo ?? '')?.[1] ?? null,
      points: points ?? 0,
      played: played ?? 0,
      won: won ?? 0,
      drawn: drawn ?? 0,
      lost: lost ?? 0,
      goalsFor: gf ?? 0,
      goalsAgainst: ga ?? 0,
    });
  });
  return out;
}
