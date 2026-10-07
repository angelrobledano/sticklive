# Auditoría — World Skate Games Asunción 2026 (rink hockey) en Stick Live

*Alta de las 4 competiciones oficiales de los World Skate Games Asunción 2026.
Trabajo realizado el 6 de octubre de 2026 (la competición está en curso: grupo
femenino y U19 en marcha, masculino e intercontinental arrancan el 11-12/10).*

## A. Mapeo de IDs

| URL oficial | idc sidgad | Competición en Stick Live | Equipos | Grupos |
|---|---|---|---|---|
| rinkhockey.worldskate.org/league/325 | 325 (temp_41) | Mundial Masculino — World Skate (`mundial-masculino-worldskate`) | 8 | A(4)+B(4) |
| rinkhockey.worldskate.org/league/329 | 329 | Mundial Femenino — World Skate (`mundial-femenino-worldskate`) | 11 | A(5)+B(6) |
| rinkhockey.worldskate.org/league/330 | 330 | Intercontinental Masculino — World Skate (`intercontinental-masculino-worldskate`) | 9 | A(4)+B(5) |
| rinkhockey.worldskate.org/league/331 | 331 | Mundial Sub-19 Masculino — World Skate (`mundial-sub19-masculino-worldskate`) | 8 | A(4)+B(4) |

El portal `www.rinkhockey.worldskate.org` es la plataforma **sidgad** (la misma
de FEP y WSE), portal `worldskate` en `www.server2.sidgad.es`, temporada
`temp_41` = 2026/27. `/league/325` corresponde al `idc` 325: los calendarios se
leen de `worldskate_cal_idc_{IDC}_1.php` y las competiciones se siembran con
`source_ref = 'wse_competition_<idc>'`, que es exactamente lo que descubre
`resolveWorldskate` — el pipeline World Skate existente las scrapea sin cambios
de descubrimiento.

## B. Formato real por competición

### 325 — Mundial Masculino (8 equipos, A: SUI/POR/ITA/ESP · B: CHI/FRA/ANG/ARG)
- **Fase 1 — GROUP PHASE** (12-14 oct): round-robin, 3 jornadas, 12 partidos. Clasifican los 4 de cada grupo.
- **Fase 2 — FINAL PHASE** (15-18 oct): Cuartos ×4 (crossovers 1ºA-4ºB, 2ºA-3ºB, 3ºA-2ºB, 4ºA-1ºB) → Semifinales ×2 → **Gold Medal** (18 oct 19:00) + **Bronze Medal** (18 oct 16:15). Perdedores de cuartos → **Puestos 5º-8º** (semis ×2, 16 oct) → **5º-6º** y **7º-8º** (17 oct). Clasificación final 1º-8º.

### 329 — Mundial Femenino (11 equipos, A: SUI/FRA/CHI/ARG/ESP · B: MEX/BRA/IND/COL/ITA/POR)
- **Fase 1 — GROUP PHASE** (4-8 oct): round-robin (A: 10 partidos, B: 15). Clasifican los **2 primeros de cada grupo** (nota oficial 02/10/2026).
- **Fase 2 — FINAL PHASE** (9-10 oct): **Semifinales ×2** (1ºA-2ºB y 1ºB-2ºA) → **Gold Medal** (10 oct 20:00) + **Bronze Medal** (10 oct 17:30). Sin cuartos.
- **Fase 3 — 5TH - 8TH PLACE** (9-10 oct, 4 partidos): colocación para 3º/4º de grupo. ⚠️ Los cruces exactos no están publicados por la fuente aún (filas sin equipos): se importan tal como los publique.
- Las selecciones 5ª+ de grupo terminan 9º-11º por su posición de grupo (sin partidos extra).

### 330 — Intercontinental Masculino (9 equipos, A: AUT/MEX/IND/MOZ · B: AUS/RSA/EGY/BRA/COL)
- **Fase 1 — GROUP PHASE** (11-14 oct): round-robin (A: 6, B: 10). Clasifican 8: todo el grupo A + los 4 primeros del B (el 5º de B queda 9º).
- **Fase 2 — FINAL PHASE** (15-18 oct): idéntica a 325 (cuartos, semis, oro 18 oct 12:45, bronce 10:00, bloque 5º-8º).

### 331 — Mundial Sub-19 Masculino (8 equipos, A: SUI/ITA/ARG/ESP · B: IND/COL/FRA/POR)
- **Fase 1 — GROUP PHASE** (4-7 oct): round-robin, 12 partidos. Clasifican los 4 de cada grupo.
- **Fase 2 — FINAL PHASE** (8-10 oct): cuartos (8 oct), semis (9 oct), **Gold Medal** (10 oct 17:45, confirmado por noticia oficial), **Bronce** (10 oct 15:15), bloque 5º-8º (9-10 oct).

### Desempates de grupo
No se ha encontrado documento oficial ASU26 que los defina; la fuente sirve las
tablas ya calculadas y Stick Live las importa tal cual (no las recalcula).
**Explícitamente no verificado documentalmente.**

## C. Fuentes oficiales utilizadas

1. **Reglamento/sistema de competición:**
   - *Competition System — Rink Hockey — World Skate Games 2024* (PDF oficial, worldskate.org → descargas WSG 2024, doc. 6805): define grupos + "2nd phase: crossovers, semi-finals and final", clasificación final 1º-8º, ascensos/descensos WC↔Intercontinental.
   - *Rink Hockey Competition Format — WSG 2024* (doc. 6707, diagrama): "2nd Round: crossings (1-4, 2-3, 3-2, 4-1)".
   - *Bulletin 01 WSG Rink Hockey* (doc. 6751).
2. **Documentación oficial WSG 2026:**
   - *Rink Hockey Draw Confirmed: Groups Set for the World Skate Games Asunción 2026* (worldskate.org, 09/07/2026): las 4 competiciones, ventanas (U19+F 3-10 oct; M 10-18 oct), sedes.
   - *First week of the Rink Hockey World Championships…* (worldskate.org, 02/10/2026): composición de grupos femenino y U19, "top two teams in each group… medals on October 9 and 10", final femenina 10 oct 20:00, cuartos U19 el 8 oct, final U19 10 oct 17:45.
   - Boletines generales WSG 2026 #01-#07 (categoría "WSG 2026 - ASUNCION"): revisados; **no** contienen el sistema de competición de hockey.
3. **Portal oficial de resultados** (`www.rinkhockey.worldskate.org`, APIs sidgad `worldskate_ls_1.php` y `worldskate_cal_idc_{IDC}_1.php`): nombres oficiales de competición, `config_params` (equipos, grupos `groups_ids`, fase "GROUP PHASE"), calendarios completos con fechas/horas/_resultados, fases "GROUP PHASE"/"FINAL PHASE"/"5TH - 8TH PLACE" y tablas de clasificación.

**No existe** (a fecha de este trabajo) un boletín ASU26 específico de sistema
de competición de rink hockey en worldskate.org; el formato 2026 se ha
documentado con el sistema oficial WSG 2024 + las noticias oficiales 2026 +
los datos del portal oficial, contrastando los tres.

## D. Discrepancias detectadas (fuente vs. documentación)

1. **GOLD MEDAL del Mundial M con `gamedate=20271018`** (año 2027): typo de la
   fuente; las noticias oficiales sitúan las finales el 17-18 de octubre de
   2026. La guarda de ventana de temporada (#229) rechazaría ese alta si el
   partido tuviera equipos; hoy no llega a insertarse (sin participantes).
   Cuando la fuente publique el cruce, si el typo persiste, el partido quedará
   fuera explícitamente (con alerta) hasta que se corrija. **No se corrige en
   silencio.**
2. **Typos cosméticos de la fuente**: "WORLD INTERCONTINETAL MEN" (por
   Intercontinental), "BRONCE MEDAL" (U19, mezcla EN/ES), "SWTZERLAND",
   "OCTUBER". Stick Live importa nombres normalizados en español; los typos
   solo afectan a las etiquetas internas de la fuente.
3. **Cruces de la fase final sin publicar** (todos los torneos): las filas de
   eliminatorias llegan sin equipos. No se fabrican equipos ficticios; las
   rondas se emiten como estructura ("por determinar") y los partidos se
   insertan cuando la fuente publica los equipos (re-scrape cada 5 min).
   El convenio de cruces documentado (crossovers 1-4/2-3/3-2/4-1 para 8
   clasificados; 1ºA-2ºB/1ºB-2ºA en semifinales femeninas) es el del sistema
   oficial WSG 2024; la asignación real vendrá dada por la fuente.

## E. Modelo de datos

- Formato como **datos**: `rounds` (una por fase/jornada con nombre canónico y
  numeración) + `matches.round_id` + `matches.group_name` (nueva, migración
  069) + `standings.group_name` + `season_teams.group_name` (grupos oficiales
  del sorteo). El frontend renderiza cualquier competición si recibe sus
  rondas/grupos; no hay ningún `if` por competición.
- Numeración de rondas (UNIQUE season+number+type): grupos `Jornada N` →
  regular N; `Puestos 5º-8º` → playoff 74; `Puestos 5º-6º` → 75; `Puestos 7º-8º`
  → 77; `Cuartos de final` → 90; `Semifinal` → 95; `3º y 4º puesto` → 98;
  `Final` → 99. (74 para las semis de la consolación: nuevo caso de ASU26.)
- Participantes dinámicos: prohibido crear equipos "1ºA"/"Winner Semifinal".
  La resolución es de la fuente: cuando sidgad publica el cruce, el re-scrape
  inserta el partido (con ref sintética si aún no hay idp y adopción posterior
  por `synthetic:` — mecanismo existente del loader).
- Selecciones: `teams.team_type='national'` con `gender`/`age_category`
  (senior/sub19), refs `wse_<idSidgad>` (ids portal-globales sidgad, sin
  colisión con los seeds WSE 1116-1129) y alias/dedupe por el embudo de
  identidad existente.

## F. Procedimiento de alta (producción)

```bash
# 1. Migraciones (069 = matches.group_name) — el runner es idempotente
$DC run --rm migrate

# 2. Seed de las 4 competiciones (idempotente)
$DC exec etl node dist/apps/etl/src/seed-worldskate-asu26.js
#    (local: npx tsx --env-file=.env apps/etl/src/seed-worldskate-asu26.ts)

# 3. Import: el scheduler ya lo hace cada 5 min (--run-once worldskate);
#    para forzarlo a mano:
$DC run --rm scraper node dist/apps/scraper/src/index.js --run-once worldskate
```

`resolveWorldskate` las descubre por `source_ref LIKE 'wse_competition_%'`;
la ventana por `seasons.end_date` (+3 días de margen) las dormirá tras el
18 de octubre automáticamente (#294).

## G. Verificación realizada

- `npm run typecheck && npm run lint && npm run test` — en verde (9/9, 5/5, 11/11 tareas; web 534 tests, scraper 102).
- Import local: 4 competiciones ok — 65 partidos de grupo, 36 rondas, 36 filas de clasificación, 44 cruces pendientes de publicación.
- Integridad: 0 source_ref duplicados, 0 partidos sin temporada, 0 partidos de fase regular sin grupo, 0 partidos de playoff con grupo, 0 equipos duplicados (36 selecciones, 17 países).
- Horas: 13:15 Asunción → 17:15Z (UTC-4 permanente, America/Asuncion).
- Clasificación contrastada con la fuente (p. ej. Francia F: GF=0, GA=14 = 0-8 ESP + 0-6 ARG).
- UI local: sección "🌍 Mundo" en el índice; ficha de competición con pestañas Clasificación/Jornadas/Playoffs; una tabla por grupo; chips "GRUPO A/B" en jornadas; cuadro con fases "POR DETERMINAR"; ficha de partido correcta.

## H. Incidencias en producción (post-deploy, 6-7 oct 2026)

1. **Plantillas incompletas** — 5 partidos jugados el 6/10 quedaron sin acta: el
   barrido `fichas-pendientes` filtraba `fep_match_%` y las ediciones World
   Skate no entraban en el modo multi. **Fix** (`d714328`): el barrido es
   multi-fuente vía `resolveMatchSourceIds` (core/sources.ts) y añade las
   ediciones World Skate en ventana. Tras el barrido: Femenino 14/14 y
   Sub-19 10/10 partidos jugados con plantilla.
2. **Escudos/banderas rotos** — el scraper construía las URLs de las
   clasificaciones con `LOGO_BASE = www.sidgad.com`, dominio que da 404 para
   los ficheros ASU26 (solo existen en `sidgad.cloud`). El standings loader
   reescribía `teams.logo_url` en cada scrape y `download-logos` fallaba 23
   veces. **Fix** (`769c7a0`): constante al CDN válido + migración 070
   (`data_sources.logo_base`) + re-seed. Resultado: 23 descargas ok / 0 fallos,
   los 36 endpoints `/teams/:id/logo` de las selecciones responden 200.
3. **Fotos de jugadoras internacionales** — `update-player-photos` sondea el
   CDN de la FEP con el id FEP; las internacionales que no compiten en la FEP
   no tienen foto posible hoy (acta sin imgs, CDN worldskate 404 en todas las
   rutas probadas, sin endpoint de perfil). Las que también juegan ligas FEP
   sí obtienen foto. Queda abierta a que World Skate publique un patrón de
   fotos — el cambio sería añadir candidatos en `player-photo-url.ts`.
