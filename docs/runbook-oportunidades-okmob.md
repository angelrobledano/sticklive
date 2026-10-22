# Runbook — oportunidades B1–B5 del análisis OKMob

Requiere el PR de identidad por portal (A1–A7) desplegado y su runbook completado ([runbook-identidad-por-portal.md](./runbook-identidad-por-portal.md)). Análisis de origen: [ANALISIS_OKMOB_MODELO_DATOS_2026-10-22.md](./ANALISIS_OKMOB_MODELO_DATOS_2026-10-22.md) §10.B.

| | Qué es | Dónde |
|---|---|---|
| B1 | Crosswalk de personas: una persona con N refs (una por portal), pares prohibidos, candidatos para revisión y redirección de la ficha absorbida | migración 084, `player-identity.ts`, `/admin/player-links` |
| B2 | Zonas de clasificación (ascenso, descenso, play-off…) por temporada con fuente normativa, aplicadas en el servidor | migración 085, `standings-zones.ts`, `/admin/seasons/:id/zones`, campo `zone` en las clasificaciones |
| B3 | Plan de alta de las competiciones vigentes de un portal | `plan-federation-coverage.ts`, [plan-cobertura-fecapa-2026-27.md](./plan-cobertura-fecapa-2026-27.md) |
| B4 | Colgar como fase o grupo de otra una competición publicada aparte | `attachCompetitionAsPhase`, `attach-competition-phase.ts` |
| B5 | `event_coverage` reconciliado con el marcador (`full` solo si el acta cuadra) y aviso en la web | migración 086, ficha, `TimelineTab` |

## Despliegue

1. `./deploy/backup-db.sh` y migrar (084, 085, 086). La 084 rellena `player_source_refs` con la ref de cada jugador. La 086 instala el trigger de cobertura. Los partidos existentes se recalculan la próxima vez que pase su ficha. Para recalcular todo de una vez:
   ```sql
   SELECT refresh_event_coverage(id) FROM matches WHERE event_coverage <> 'none';
   ```
   Ojo: los que queden en `partial` dejan de contar en los insights de temporada (solo usan `full`). Es lo correcto, pero conviene mirar cuántos son antes.

## B1 · Revisar candidatos de misma persona

```bash
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://sticklive.eu/api/admin/player-links/generate
curl -H "X-Admin-Token: $ADMIN_TOKEN" https://sticklive.eu/api/admin/player-links
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://sticklive.eu/api/admin/player-links/<id>/accept   # o /reject
```

Los candidatos son mismo nombre en portales distintos (dos fichas del mismo portal con el mismo nombre son homónimos). Puntúan 0,95 si comparten club y 0,80 si no. Nunca se enlaza solo. Rechazar prohíbe el par para siempre. Aceptar conserva la ficha más antigua, mueve plantillas, alineaciones, eventos y favoritos, y la ficha absorbida redirige con 308. Empezar por los de 0,95 y por jugadores de máxima categoría. Falta la página del panel: hoy es solo API.

## B2 · Cargar zonas

```bash
curl -X PUT -H "X-Admin-Token: $ADMIN_TOKEN" -H "content-type: application/json" \
  https://sticklive.eu/api/admin/seasons/<seasonId>/zones \
  -d '{"sourceNote":"Bases OK Liga 2026/27, art. X","zones":[
        {"kind":"champion","posFrom":1,"posTo":1},
        {"kind":"promotion_playoff","posFrom":1,"posTo":8,"target":"Play-off por el título"},
        {"kind":"relegation","posFrom":14,"posTo":16,"target":"OK Liga Plata"}]}'
```

Para abrir una temporada nueva: `POST /admin/seasons/<nueva>/zones/copy-from/<anterior>` y revisar. `GET /seasons/:id/standings` y el overview de temporada devuelven `zone: { kind, target }` por fila. La web todavía no las pinta: falta el cambio de UI.

## B3 · Cobertura FECAPA

Ver [plan-cobertura-fecapa-2026-27.md](./plan-cobertura-fecapa-2026-27.md): 57 competiciones pendientes, 42 clasificadas solas y 15 a revisar. Regenerar antes de dar de alta:

```bash
npx tsx apps/etl/src/plan-federation-coverage.ts --portal=fecapa --temp=41
```

## B4 · Fusionar fases publicadas aparte

Candidatas en producción: `OK LIGA PLATA MASCULINA ELIMINATORIA` → fase de `OK LIGA PLATA` (o de Norte/Sur, según se decida) y `OK LIGA BRONCE ELIMINATORIA`. Grupos territoriales (`OK LIGA PLATA NORTE`/`SUR`) solo si se decide una competición madre que los agrupe.

```bash
npx tsx apps/etl/src/attach-competition-phase.ts --child=<uuid> --parent=<uuid> --kind=knockout            # plan
npx tsx apps/etl/src/attach-competition-phase.ts --child=<uuid> --parent=<uuid> --kind=knockout --write
# grupo territorial:
npx tsx apps/etl/src/attach-competition-phase.ts --child=<uuid> --parent=<uuid> --kind=groups --group=Sur --write
```

Empareja temporadas por nombre y falla si alguna de la hija no tiene pareja. Deja el idc de la hija en `playoff_idcs` de la madre (el pipeline lo sigue cargando dentro de la madre) y la URL de la hija redirige con 308.
