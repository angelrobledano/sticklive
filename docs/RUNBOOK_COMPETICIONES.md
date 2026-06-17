# Runbook — alta y gestión de competiciones

*Actualizado: 17 de junio de 2026*

Cómo añadir una competición nueva, fusionar liga + playoff, y los errores que cuestan una tarde si no los conoces. Pensado para ejecutarse contra producción (Hetzner + Docker Compose en `/opt/sticklive`).

---

## Conceptos previos

- **`idc`**: identificador de competición en la fuente FEP (`sidgad`/`rfep`). Cada competición-temporada tiene el suyo. El histórico se importa por lista de `idc`.
- **`temp_39`**: temporada actual 2025/26 en la fuente. `is_current` se marca cuando `comp.tempId === '39'`.
- **Modelo de datos**: `competitions → seasons (is_current única por competición) → rounds (round_type: regular/playoff/cup/friendly) → matches`. La competición de un partido se deriva vía su `season`.
- **Una competición = liga + playoff**: la OK Liga (masc. y fem.) es **una sola competición**; los partidos de playoff son `rounds` con `round_type='playoff'` dentro de la misma temporada. Las copas/campeonatos de España se modelan también como rondas de playoff.

---

## Decisión de modelo: deduplicar equipos POR REFERENCIA, no por slug

Un mismo club juega varias competiciones a la vez (p. ej. Barça en OK Liga **y** en Campeonato de España). Para que sea **una sola entidad** y los favoritos/escudos funcionen en todas:

- Los equipos se resuelven por `source_ref` / `alt_source_refs` (la ref FEP), **no** por `slug`.
- Si la ref ya existe → se reutiliza el equipo, añadiendo la nueva ref a `alt_source_refs` si difiere.
- Si no hay match → se crea equipo nuevo con **slug único** (sufijo de género/ref para evitar colisiones de `UNIQUE(sport_id, slug)`).

Esto lo gestiona `import-history.ts` con la resolución *dedupe-by-ref*. No volver a deduplicar por nombre/slug: dos clubes distintos pueden compartir nombre corto.

---

## Alta de una competición nueva (temporada actual)

Desde el servidor, con el alias de Compose cargado:

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
# Proteger los scripts modificados en el server antes de cualquier git pull:
git checkout -- deploy/backup-db.sh deploy/restore-sports-dump.sh
git pull
```

1. **Importar el catálogo + calendario + clasificación + actas** de una o varias `idc`:

   ```bash
   $DC exec etl npx tsx apps/etl/src/import-history.ts --only-idc=3150,3481,3484 --fichas
   ```

   - `--only-idc=` acepta **lista separada por comas**.
   - `--fichas` añade `fichas-pendientes` al bucle de scrape, para volcar actas (alineaciones + jugadores) de los partidos ya jugados.
   - `is_current` se pone solo si la temporada es la `39`.

2. **Lanzar el pipeline** para crear rondas de playoff/copa y consolidar:

   ```bash
   $DC exec etl npx tsx apps/etl/src/run-pipeline.ts
   ```

   - `PLAYOFF_IDCS_PIPELINE = ['3481','3484']` → esas `idc` se tratan como rondas de playoff.
   - Las `idc` de copa (CUP_IDCS) generan rondas de playoff cuyo número/nombre sale del `roundRef` del calendario.

3. **Verificar** en la web que aparecen los partidos, que el equipo compartido no se ha duplicado, y que la etiqueta de competición es correcta en la home.

---

## ⚠️ Gotcha que rompe todo: `FEP_SOURCE_ID`

Si el `FEP_SOURCE_ID` queda como **UUID placeholder** (no el real de la fila `sources`), los scrapers escriben con un `source_id` que no existe y **toda la importación queda huérfana / falla en cascada**. Antes de importar, confirmar que el `source_id` real está resuelto (helper `requireFepSourceId`, no fallback placeholder). Es el primer sitio donde mirar si "no aparece nada" tras un import aparentemente correcto.

---

## Fusionar liga + playoff femenino (patrón migración 026)

La OK Liga Femenina llegó como dos competiciones separadas (`ok-liga-femenina` y `playoff-ok-liga-femenina`). Para que sea una sola, igual que la masculina, la **migración 026** mueve los partidos del playoff a la temporada de la liga femenina como rondas `round_type='playoff'`. Es el espejo de la 014 (que hizo lo mismo para la masculina).

Si en el futuro otra competición llega partida igual, **clonar la 026** cambiando los slugs de origen/destino. No hace falta tocar código de la app: el modelo ya muestra liga+playoff como pestañas de una misma competición.

---

## Reconstrucción de la BD desde cero (lo que se hizo el 16/06)

La BD de producción se vació y se reconstruyó solo con la OK Liga vigente (`idc` 3150 + 3481), borrando el histórico. Tras un vaciado así:

1. **Reaplicar TODAS las migraciones** (el esquema se recrea, pero el runner es idempotente):

   ```bash
   $DC exec api npx tsx packages/db/src/migrate.ts
   ```

   Saltarse esto provoca errores como `column "session_expires_at" does not exist` (migraciones 023/024 sin aplicar) o el magic link devolviendo 500.

2. **Seed + import + pipeline** de las competiciones deseadas (secciones anteriores).

3. El histórico multianual se vuelca **aparte** (pg_dump local → restore), no se mezcla en esta reconstrucción.

---

## Directo multi-competición

El cron de directo (`cron-live.ts`) mantiene su camino crítico para la OK Liga y añade una **pasada adicional aislada** (`activeSecondarySeasons` + `scrapeSeasonScores`) que actualiza marcadores de **todas las competiciones senior y copas de la temporada en curso**. Es aditiva: si esa pasada falla, la OK Liga sigue actualizándose. Los avisos push se segmentan por equipo/liga/jugador favorito (ver [NOTIFICACIONES.md](./NOTIFICACIONES.md)).

---

## Checklist rápido

- [ ] `git checkout --` de los scripts del server antes de `git pull`.
- [ ] `FEP_SOURCE_ID` real resuelto (no placeholder).
- [ ] `import-history --only-idc=… [--fichas]`.
- [ ] `run-pipeline` para rondas de playoff/copa.
- [ ] Migraciones aplicadas si se reconstruyó la BD.
- [ ] Verificación en web: partidos visibles, equipo compartido no duplicado, etiqueta de competición correcta.
