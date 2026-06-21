# Incidencia directo — Final OK Liga Igualada vs Liceo (21/06/2026)

**Partido:** Igualada (IHC) vs Liceo (HCL) · idp `34259` · PLAY OFF OK LIGA (idc 3481) · 20:30
**Estado final de la depuración:** RESUELTO en producción durante el partido.

## Resumen ejecutivo
El "directo no funcionaba" en algunos partidos. La descarga y el parseo de datos (marcadores y ficha de eventos) **funcionaban correctamente** desde el primer momento. El fallo era de **datos**: los equipos no tenían registrados los ids de club que usa el feed de directo, por lo que el partido se omitía antes de llegar a la web.

## Diagnóstico
Validado con una sonda de solo lectura (`apps/scraper/src/scrapers/fep/live-probe.ts`) ejecutada desde el PC y comparada con los logs de `cron-live` en el VPS.

- `rfep_mc_1.php` (marcadores) devuelve el equipo por **id de CLUB**: clases `club_69`/`club_44` → ref `fep_club_69`/`fep_club_44`.
- `fep-calendar.scraper` usa el **id de EQUIPO sidgad**: clases `team_3408` → ref `3408`. Son sistemas de id distintos.
- `RefResolver.resolveTeam('fep_club_69')` falla en sus tres estrategias (source_ref, slug, similitud de nombre) → lanza "No se encontró equipo".
- El plan B del loader (`UPDATE … WHERE source_ref='fep_match_34259'`) solo actualiza marcador si el partido **ya existe**. La final a-X-partidos **no se publica en el calendario estático** (solo en el feed `mc`), así que el game 4 nunca tuvo fila previa → omitido → nunca pasó a `live` → nunca se le pidió la ficha.
- Causa de fondo: tras el RESET/reseed del 16/06 los equipos quedaron **sin** los `fep_club_*` en `alt_source_refs`. El mecanismo para esto ya existía (migración `005_team_alt_source_refs.sql`); solo faltaban los datos.

## Fix aplicado (en caliente, producción)
```sql
UPDATE teams SET alt_source_refs = array_append(alt_source_refs,'fep_club_69')
  WHERE source_ref='3408' AND NOT ('fep_club_69'=ANY(alt_source_refs)); -- Igualada
UPDATE teams SET alt_source_refs = array_append(alt_source_refs,'fep_club_44')
  WHERE source_ref='3373' AND NOT ('fep_club_44'=ANY(alt_source_refs)); -- Liceo
```
Resultado al ciclo siguiente de `cron-live`: el directo resolvió los equipos, hizo upsert completo (creó `fep_match_34259`, matchId `e8e2a7c4-…`), lo puso `live` con marcador y sacó la ficha vía `rfep_gr_34259_1.php` → 10 eventos, 7 jugadores, faltas 4-2, 30 alineaciones, push de gol disparado.

## Incidencias secundarias detectadas (pendientes)
1. **Calendario de playoff no registra los games de final** (a-X-partidos): los games 4/5 solo aparecen en `mc`. El fix por alt_source_refs los desbloquea, pero conviene revisar por qué el calendario horario no los crea.
2. **Partido zombi `32851`** atascado en `status='live'`: en cada ciclo se le pide la ficha y da 404 (`rfep_gr_32851_1.php`, `rfep_acta_idc_3150_1.php`, `rfep_acta_eli_idc_3150_1.php`). Hay que forzarlo a `finished`.
3. Detección de estado: el HTML real marca el directo con clase `scorer_game_playing` (el código esperaba `scorer_game_live`). Corregido en `fep-matches.scraper.ts` (`inferStatus`) — pendiente de rebuild+deploy en el VPS.

## Fix durable recomendado (no hecho aún)
Registrar automáticamente los `fep_club_*` como `alt_source_ref` de cada equipo, en el seed o en el scraper de competiciones/calendario (capturando las clases `club_XX` cuando estén disponibles), para que el directo sea autónomo y no dependa de SQL manual ni de que el calendario haya creado el partido antes.

## Mapeo de referencias (esta temporada)
| Equipo | abbr | club_id (mc) | team_id (calendario) |
|---|---|---|---|
| Igualada | IHC | club_69 → `fep_club_69` | `3408` |
| Liceo | HCL | club_44 → `fep_club_44` | `3373` |
