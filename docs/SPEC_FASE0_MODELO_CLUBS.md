# Spec técnico — Fase 0: modelo de clubes (Entity Resolution)

> **ESTADO: IMPLEMENTADO** (migraciones 044–046, desplegado). El as-built y la operativa están en [RUNBOOK_ENTITY_RESOLUTION.md](./RUNBOOK_ENTITY_RESOLUTION.md). Se conserva como registro del diseño.

*Fundación del modelo `clubs` / `club_names` / `sponsors` / `source_entity_map` sobre el esquema actual de Stick Live, sin romper producción.*

Ref.: `docs/ARQUITECTURA_ENTITY_RESOLUTION.md` (Opción B, embudo). Esta Fase 0 crea el andamiaje; NO resuelve entidades todavía (eso son las fases 2‑3).

---

## 1. Punto de partida real (lo que ya existe)

`teams` **no es un "team" puro, es un club aplanado**. Ya trae casi todo lo que el modelo necesita, disperso:

| Columna actual en `teams` | Qué es en el modelo objetivo |
|---|---|
| `name`, `short_name`, `slug` | nombre (mezcla identidad + patrocinio) |
| `city`, `country`, `logo_url`, `website_url` | atributos de **club** |
| `gender` (032), `age_category` (032) | atributos de **team** (sección) |
| `source_ref`, `alt_source_refs[]` (005) | mapeo de IDs de fuente → hace de `source_entity_map` aplanado |
| `source_id`, `source_url`, `scraped_at` | trazabilidad |

**No existe** `clubs`, `club_names`, `sponsors`, `squad_level` (el filial va embebido en el nombre: "Liceo B").

**Tablas que referencian `teams`** (radio de impacto — por eso nada destructivo en Fase 0):
`matches.home_team_id` / `matches.away_team_id`, `standings.team_id`, `season_teams.team_id`, `team_players.team_id`, `match_lineups` (vía `is_home`), `match_events.team_id`.

---

## 2. Principios de esta fase

1. **Estrictamente aditivo.** Se crean tablas nuevas y columnas *nullable*. `teams` y todo lo que cuelga de él sigue funcionando **byte a byte igual**. El directo no se entera.
2. **Reversible.** Todo backfill es idempotente y tiene su `DOWN` (o es des-referenciable). Ninguna entidad se borra; se marca.
3. **Sin fusión automática.** La Fase 0 crea **un club por cada team (1:1)**. Agrupar el Liceo masc + fem + B bajo un club es el problema de ER, y se hace en fases 2‑3 con fuzzy + HITL. Fusionar mal en un backfill masivo repetiría el bug del duplicado de Liceo a lo bestia.
4. **Coexistencia, no sustitución.** `source_entity_map` se puebla desde `source_ref`/`alt_source_refs`, pero **estos NO se borran** hasta migrar todo el consumo (fase posterior). Dos verdades en paralelo hasta que la nueva esté probada en caliente.
5. **La `UNIQUE` de secciones llega DESPUÉS.** `UNIQUE(club_id, gender, age_category, squad_level)` es el objetivo, pero **no se impone en Fase 0**: con backfill 1:1 y datos sucios reventaría. Se añade tras la limpieza/fusión (fase 3).

---

## 3. DDL — tablas nuevas (migración aditiva, un solo `up`)

```sql
-- === Identidad estable del club ===
CREATE TABLE clubs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id       UUID NOT NULL REFERENCES sports(id),
  canonical_name TEXT NOT NULL,            -- nombre deportivo sin sponsor
  slug           TEXT NOT NULL,
  city           TEXT,
  region         TEXT,
  country        TEXT NOT NULL DEFAULT 'ES',
  founded_year   INT,
  crest_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport_id, slug)
);

CREATE TABLE sponsors (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT NOT NULL UNIQUE,            -- "Coinasa" — token a STRIPear en la normalización
  aliases TEXT[] NOT NULL DEFAULT '{}'
);

-- Nombre comercial con vigencia (historial de patrocinio)
CREATE TABLE club_names (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  commercial_name TEXT NOT NULL,
  sponsor_id      UUID REFERENCES sponsors(id),
  valid_from      DATE NOT NULL,
  valid_to        DATE,                    -- NULL = vigente
  UNIQUE (club_id, commercial_name, valid_from)
);

-- Mapeo determinista ID-de-fuente → entidad (reemplazo estructurado de source_ref/alt_source_refs)
CREATE TABLE source_entity_map (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   UUID NOT NULL REFERENCES data_sources(id),
  source_ref  TEXT NOT NULL,               -- 'fep_club_71', 'fep_match_...', 'wse_team_...'
  club_id     UUID REFERENCES clubs(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  status      TEXT NOT NULL DEFAULT 'confirmed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(club_id, team_id) = 1),
  UNIQUE (source_id, source_ref)
);

-- Enlace en teams (nullable en Fase 0) + nivel de filial explícito
ALTER TABLE teams ADD COLUMN IF NOT EXISTS club_id     UUID REFERENCES clubs(id);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS squad_level SMALLINT NOT NULL DEFAULT 1; -- 1=A, 2=B...
CREATE INDEX IF NOT EXISTS idx_teams_club_id ON teams (club_id);
```

`team_aliases` y `resolution_queue` (del informe) **no entran aquí**: son de las fases 2‑3 (fuzzy + HITL). Fase 0 = identidad + mapeo determinista.

---

## 4. Backfill (script idempotente, NO migración destructiva)

Se ejecuta como script del ETL (como tus `seed-*`), reversible y re-ejecutable. Orden:

### 4.1 Un club por team (1:1)

```sql
-- Crea un club por cada team y lo enlaza. slug de club derivado del de team.
WITH nuevos AS (
  INSERT INTO clubs (sport_id, canonical_name, slug, city, country, crest_url)
  SELECT t.sport_id, t.name, t.slug, t.city, t.country, t.logo_url
  FROM teams t
  WHERE t.club_id IS NULL           -- idempotente
  RETURNING id, sport_id, slug
)
UPDATE teams t
   SET club_id = n.id
  FROM nuevos n
 WHERE n.sport_id = t.sport_id AND n.slug = t.slug AND t.club_id IS NULL;
```

> **Cuidado con el `slug`.** El join usa `(sport_id, slug)`, que es único en `teams`. Si prefieres evitar depender de eso, la variante robusta es un script TS que itera cada team, hace `INSERT ... RETURNING id` y `UPDATE` con ese id (más lento pero sin supuestos). Recomendado para producción.

`canonical_name` inicial = `teams.name` (aún con sponsor). Limpiarlo (quitar patrocinador) es trabajo de la fase de sponsors; no bloquea.

### 4.2 `source_entity_map` desde `source_ref` + `alt_source_refs`

```sql
-- source_ref principal → team
INSERT INTO source_entity_map (source_id, source_ref, team_id)
SELECT t.source_id, t.source_ref, t.id
FROM teams t
WHERE t.source_id IS NOT NULL AND t.source_ref IS NOT NULL
ON CONFLICT (source_id, source_ref) DO NOTHING;

-- cada alt_source_ref (fep_club_XX) → mismo team
INSERT INTO source_entity_map (source_id, source_ref, team_id)
SELECT t.source_id, alt, t.id
FROM teams t, unnest(t.alt_source_refs) AS alt
WHERE t.source_id IS NOT NULL
ON CONFLICT (source_id, source_ref) DO NOTHING;
```

`source_ref`/`alt_source_refs` en `teams` **se conservan**; `source_entity_map` es la copia estructurada para el futuro pipeline. La migración del consumo (leer de `source_entity_map` en vez del array) es una fase posterior.

### 4.3 `club_names` inicial

```sql
-- Nombre comercial vigente = nombre actual del club (una fila; el histórico se rellena luego)
INSERT INTO club_names (club_id, commercial_name, valid_from)
SELECT c.id, c.canonical_name, DATE '2024-08-01'   -- inicio de temporada actual
FROM clubs c
ON CONFLICT DO NOTHING;
```

`sponsors` y el histórico de nombres ("Coinasa Liceo" 2019‑21) se cargan incrementalmente (semilla manual + HITL), no en el backfill masivo.

---

## 5. Orden de ejecución (por PRs, con verde y despliegue entre cada uno)

| PR | Contenido | Riesgo | Reversible |
|---|---|---|---|
| **F0.1** | Migración aditiva §3 (4 tablas + 2 columnas nullable) | 🟢 Muy bajo (solo `CREATE`/`ADD COLUMN`) | Sí (`DROP`) |
| **F0.2** | Script de backfill §4 (1:1 + map + club_names) + tests de integración | 🟡 Bajo (no toca datos existentes, solo añade filas nuevas y rellena `club_id`) | Sí (`UPDATE teams SET club_id=NULL` + `TRUNCATE` de las nuevas) |
| **F0.3** | Lectura: API expone `club` (agrupa secciones donde aporte) leyendo `club_id`; web opcional | 🟢 Bajo (solo lectura additiva) | Sí |

Todo lo demás (fusión de duplicados, `team_aliases`, `resolution_queue`, imponer la `UNIQUE` de secciones, migrar el consumo del directo a `source_entity_map`) es **fase 2‑3**, fuera de este spec.

---

## 6. Tests de integración requeridos (Postgres real, patrón `tests/integration/`)

Bloqueantes antes de mergear F0.2:

1. **Migración limpia e idempotente:** aplicar F0.1 dos veces no falla; las FKs y el `CHECK (num_nonnulls…)` existen.
2. **Backfill: cobertura total:** tras el script, `COUNT(*) FROM teams WHERE club_id IS NULL` = 0. Ningún team se queda huérfano.
3. **Backfill: sin pérdida ni cruce:** nº de `clubs` = nº de `teams` (1:1); ningún `team` apunta al club de otro (`teams.slug` = `clubs.slug` del enlazado).
4. **`source_entity_map` completo:** por cada `(source_ref)` y cada elemento de `alt_source_refs`, existe exactamente una fila mapeando al team correcto; el `CHECK` de "exactamente una entidad" se respeta.
5. **Idempotencia del backfill:** re-ejecutarlo no crea duplicados (los `ON CONFLICT`/`WHERE club_id IS NULL` funcionan).
6. **Invariante de integridad del directo:** un `match` de ejemplo sigue resolviendo `home_team_id`/`away_team_id` igual que antes (la Fase 0 no toca esa relación).
7. **Reversibilidad:** el `DOWN` deja `teams` idéntico al estado previo (mismo hash de columnas relevantes).

---

## 7. Riesgos y mitigaciones

- **Producción en vivo (OK Liga).** → Todo aditivo; el backfill solo escribe filas nuevas y rellena `club_id` (columna nueva que nadie lee aún). Ventana: hacerlo fuera de jornada por prudencia, aunque no bloquea escrituras.
- **`slug` no único entre deportes.** → Join por `(sport_id, slug)` o script TS con `RETURNING`. Test #3 lo blinda.
- **Entorno de test.** → **Requisito duro:** F0.2 no se mergea sin los tests §6 en verde. Hoy el `node_modules` del sandbox está roto; esta fase espera a entorno sano (motivo por el que este spec existe en vez de una migración a ciegas).
- **Tentación de fusionar en el backfill.** → Prohibido en Fase 0. 1:1 y a fusionar con ER. La `UNIQUE` de secciones se pospone.

---

## 8. Definición de "hecho" de la Fase 0

- `clubs`/`club_names`/`sponsors`/`source_entity_map` existen y están pobladas 1:1.
- Todo `team` tiene `club_id`; `source_entity_map` refleja `source_ref` + `alt_source_refs`.
- El sistema se comporta **exactamente igual** que antes para el usuario (la Fase 0 no cambia nada visible; habilita las fases 2‑3).
- Tests §6 en verde; despliegue verificado (migrate aplica, directo intacto).

Con esto, la Fase 1 (embudo determinista) ya tiene dónde escribir: resolver por `source_entity_map` y, más adelante, `team_aliases`.
