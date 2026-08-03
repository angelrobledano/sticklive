# Resolución de Entidades para Stick Live — Informe de Arquitectura

*Clubes, equipos y nombres volátiles en la ingesta por scraping de hockey sobre patines.*

---

## 0. Encuadre del problema (y el activo que ya tienes)

Antes de elegir arquitectura hay que nombrar una cosa que cambia todo el análisis: **el problema de "nombres volátiles" es, en su mayor parte, un falso problema en tu caso concreto.**

La fuente principal (sidgad/FEP) **no te da nombres, te da IDs estables**: `fep_club_71` sigue siendo `fep_club_71` aunque el club pase de "Coinasa Liceo" a "Deportivo Liceo". Ya lo explotas con `source_ref` y `alt_source_refs`. Eso significa que la resolución **dentro de una misma fuente** (intra-source) es un `JOIN` determinista: coste cero, latencia cero, precisión 100%. El nombre comercial es solo *decoración* que se guarda aparte.

El problema difícil de verdad —el que justifica un pipeline de Entity Resolution— aparece en dos frentes:

1. **Resolución inter-fuente:** cuando el mismo club llega desde fuentes que **no comparten ID**. Es exactamente lo que se te viene encima con **Portugal e Italia** (federaciones propias, hora local, IDs propios). El "Sporting CP" de la fed. portuguesa y un eventual cruce europeo de World Skate no traen el mismo identificador.
2. **Fuentes nuevas sin ID o con HTML sucio:** ligas regionales, actas mal formadas, abreviaturas (`fep_abbr_LIC`) cuando falta el club_id.

**Conclusión de encuadre:** no necesitas un motor de ER caro que resuelva millones de filas por nombre. Necesitas un **embudo** donde el 95%+ se resuelve por ID (gratis) y solo el residuo —entidades nuevas e inter-fuente— pasa por resolución textual/semántica, con humano en el bucle. Todo el informe se apoya en esta distinción.

---

## 1. Análisis de opciones de arquitectura

### Opción A — Determinista + algoritmos de distancia

Tablas de alias en SQL + búsqueda difusa (`pg_trgm` / Levenshtein / similitud de trigramas), sin capa de aprendizaje ni ML.

- **Cómo funciona:** normalizas el nombre entrante (minúsculas, sin acentos, sin sponsor, sin sufijos de categoría) y lo buscas contra `team_aliases`; si no hay match exacto, `similarity()` con umbral y te quedas con el mejor candidato.
- **Fortalezas:** cero dependencias externas, todo dentro de Postgres, latencia sub-milisegundo con índice GIN de trigramas, coste marginal nulo, 100% auditable y determinista (mismo input → mismo output, reproducible en tests).
- **Debilidades:** el fuzzy "a pelo" es frágil con nombres cortos de club ("Liceo" vs "Reus" vs "Lleida" — distancias engañosas), no distingue semántica ("Deportivo" ≈ "CD" ≈ "Club Deportivo"), y **sin capa de HITL estructurada tiende a crear duplicados** (justo el bug del Liceo que ya tuviste que arreglar con un merge manual `d54e5b4d→ccc49524`). Se queda corta para el cruce inter-fuente PT/IT.

### Opción B — Híbrida en embudo / pipeline (la que recomiendo)

Reglas deterministas → caché de alias en BD → fuzzy con bloqueo → **HITL** → LLM **en lote solo para el backlog**. Cada resolución confirmada retroalimenta la caché de alias.

- **Cómo funciona:** cascada de escalones con corte temprano. Escalón 1: match por `source_ref` (ID de fuente). Escalón 2: alias normalizado exacto. Escalón 3: fuzzy `pg_trgm` **acotado por clave de bloqueo** (país/ciudad/categoría/género) con umbral de auto-confirmación. Escalón 4: lo dudoso (<umbral) no se inventa: cae a una **cola de staging** para revisión. Escalón 5 (opcional, diferido): un job nocturno pasa el backlog de la cola por un LLM **en batch** para *pre-sugerir* el match al humano, nunca para decidir en caliente.
- **Fortalezas:** aprovecha el ID de fuente (tu activo), coste de LLM acotado a "entidades nuevas por temporada" (céntimos, no por fila), latencia de ingesta baja (todo en Postgres en caliente), precisión **alta y creciente** (el sistema aprende: lo resuelto una vez baja a match exacto para siempre), resiliencia real (staging + reversible + auditable). Encaja en tu stack sin infra nueva.
- **Debilidades:** más piezas móviles que A (una cola, un panel, umbrales que calibrar). Es complejidad *gestionable* y por fases.

### Opción C — Búsqueda vectorial / grafos (Embeddings + pgvector o BD de grafos)

Representar cada entidad como *embedding* y resolver por vecindad semántica; o modelar un grafo de identidades y resolver por conectividad.

- **Cómo funciona:** generas un vector por nombre canónico/alias, indexas con HNSW (`pgvector`), y para cada entrante buscas el vecino más próximo por coseno.
- **Fortalezas:** brilla con **texto largo y semántica difusa** (descripciones, sinónimos, multilingüe). El multilingüe PT/IT/ES suena tentador.
- **Debilidades para *este* dominio:** los nombres de club son **cadenas cortas y de alta entropía léxica** ("Liceo", "Reus Deportiu", "Igualada"). Ahí los embeddings **pierden frente a los trigramas + reglas de dominio**: dan falsos positivos semánticos ("Deportivo Liceo" cerca de "Club Deportivo X" por el token "Deportivo") y no capturan que el discriminador real es la **ciudad y la categoría**, no la semántica. Añade infra y coste de generación de embeddings, y sigues necesitando HITL igual. **No es el núcleo; como mucho es *un* escalón más de generación de candidatos dentro del embudo (B), no una arquitectura por sí sola.**

---

## 2. Matriz de decisión y trade-offs

Valoración: 🟢 fuerte · 🟡 aceptable · 🔴 débil. Coste: €=bajo, €€€=alto.

| Criterio | A · Determinista+Fuzzy | B · Híbrida en embudo | C · Vectorial/Grafos |
|---|---|---|---|
| **Coste infra + API (corto plazo)** | 🟢 € (solo Postgres) | 🟢 € (Postgres; LLM aún no) | 🔴 €€ (pgvector + generación de embeddings) |
| **Coste (largo plazo, en régimen)** | 🟢 € | 🟢 € (LLM solo backlog nuevo ≈ céntimos/temporada) | 🟡 €€ (re-embedding, tuning HNSW) |
| **Latencia en ingesta** | 🟢 Sub-ms (índice trigram) | 🟢 Sub-ms en caliente; LLM asíncrono en lote | 🟡 ms (ANN) + coste de embed por entrante |
| **Precisión de normalización** | 🟡 Media (frágil en nombres cortos e inter-fuente) | 🟢 Alta y **creciente** (aprende vía aliases) | 🟡 Media (falsos positivos semánticos en cadenas cortas) |
| **Complejidad dev/mantenimiento** | 🟢 Baja | 🟡 Media (cola + panel + umbrales) | 🔴 Alta (infra vectorial + pipeline igualmente) |
| **Resiliencia / recuperación de errores** | 🔴 Baja (auto-crea duplicados; difícil revertir) | 🟢 Alta (staging, reversible, auditable, HITL) | 🟡 Media (reversible, pero caja más negra) |
| **Encaje con tu stack actual** | 🟢 Total | 🟢 Total (evolución de lo que ya tienes) | 🔴 Requiere pieza nueva |
| **Preparación para PT/IT (inter-fuente)** | 🔴 Insuficiente | 🟢 Diseñada para ello | 🟡 Ayuda, pero no basta sola |

**Lectura:** A es el punto de partida que ya tienes a medias, pero se rompe justo donde vas a crecer (inter-fuente) y donde ya te dolió (duplicados). C es una solución cara a un problema que no es el tuyo (semántica de texto largo). **B contiene lo mejor de A como sus dos primeros escalones y añade exactamente lo que falta: aprendizaje, HITL y un fallback de LLM barato y acotado.**

---

## 3. Modelo de datos recomendado

Principio rector: **separar la identidad estable (club) de su representación volátil (nombre comercial) y de sus manifestaciones deportivas (equipos por género/categoría/filial).** El historial de 10 años cuelga siempre de IDs inmutables; los nombres son datos con vigencia temporal, nunca claves.

### 3.1 Jerarquía conceptual

```
club  (identidad estable: "Hockey Club Liceo", A Coruña)
 ├── club_names   → "Coinasa Liceo" (2019-21), "Deportivo Liceo" (2022-...)   [historial de patrocinio]
 └── teams        → una fila por (género × categoría × nivel de filial)
      ├── (masc, senior, A)   ← juega OK Liga
      ├── (masc, senior, B)   ← juega 1ª Nacional
      ├── (fem,  senior, A)   ← juega OK Liga Fem
      └── (masc, juvenil, A)  ← juega liga juvenil
           └── cada team ⇄ source_entity_map (IDs por fuente) ⇄ team_aliases (nombres vistos)
```

### 3.2 DDL (PostgreSQL, alineado con tus convenciones: UUID, snake_case, `source_ref`)

```sql
-- La IDENTIDAD. Nunca cambia en 10+ años. El "ancla" del historial.
CREATE TABLE clubs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id       UUID NOT NULL REFERENCES sports(id),
  canonical_name TEXT NOT NULL,        -- nombre deportivo SIN sponsor: "Hockey Club Liceo"
  slug           TEXT NOT NULL UNIQUE,
  city           TEXT,
  region         TEXT,                 -- Galicia, Cataluña...
  country        TEXT NOT NULL,        -- ISO-3166-1 alpha-2; clave de bloqueo inter-fuente
  founded_year   INT,
  crest_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nombre COMERCIAL con vigencia. Aquí vive el patrocinio; el nombre NUNCA es clave.
CREATE TABLE sponsors (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name     TEXT NOT NULL UNIQUE,       -- "Coinasa" — se usa para STRIP en la normalización
  aliases  TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE club_names (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  commercial_name TEXT NOT NULL,       -- "Coinasa Liceo"
  sponsor_id      UUID REFERENCES sponsors(id),
  valid_from      DATE NOT NULL,       -- inicio de la temporada en que aplica
  valid_to        DATE,                -- NULL = vigente
  UNIQUE (club_id, commercial_name, valid_from)
);

-- El EQUIPO: lo que realmente juega partidos. Separa género, categoría y filial.
CREATE TABLE teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      UUID NOT NULL REFERENCES clubs(id) ON DELETE RESTRICT,
  gender       TEXT NOT NULL CHECK (gender IN ('male','female','mixed')),
  age_category TEXT NOT NULL,          -- senior|junior|juvenil|cadete|infantil|alevin|benjamin
  squad_level  SMALLINT NOT NULL DEFAULT 1, -- 1 = primer equipo (A), 2 = B, 3 = C...
  display_name TEXT NOT NULL,          -- derivado para UI: "Deportivo Liceo B"
  UNIQUE (club_id, gender, age_category, squad_level)
);

-- ESCALÓN 1 (determinista). El ID que la FUENTE asigna. Tu activo actual (source_ref).
-- FK "polimórfica" resuelta con dos columnas + CHECK (integridad referencial real).
CREATE TABLE source_entity_map (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   UUID NOT NULL REFERENCES data_sources(id),
  source_ref  TEXT NOT NULL,           -- 'fep_club_71', 'fpp_club_...', 'wse_team_...'
  club_id     UUID REFERENCES clubs(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  status      TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | pending
  CHECK (num_nonnulls(club_id, team_id) = 1),     -- exactamente una entidad
  UNIQUE (source_id, source_ref)
);

-- ESCALÓN 2 (caché que APRENDE). Alias textuales normalizados → team.
CREATE TABLE team_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL,           -- "COINASA LICEO B" tal cual vino
  normalized  TEXT NOT NULL,           -- "liceo" tras normalizar (sin sponsor/categoría)
  source_id   UUID REFERENCES data_sources(id),
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  status      TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | pending | rejected
  created_by  TEXT NOT NULL,           -- 'deterministic' | 'fuzzy' | 'llm' | 'human:<user>'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (normalized, source_id)
);
-- Búsqueda difusa a escala sin O(n²): índice GIN de trigramas.
CREATE INDEX idx_team_aliases_trgm ON team_aliases USING gin (normalized gin_trgm_ops);

-- ESCALÓN 4 (HITL). Cola de staging: lo que NO se resolvió con confianza.
CREATE TABLE resolution_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text         TEXT NOT NULL,
  normalized       TEXT NOT NULL,
  source_id        UUID NOT NULL REFERENCES data_sources(id),
  source_ref       TEXT,
  context          JSONB NOT NULL,     -- {competition, season, city, gender, category, opponent}
  candidates       JSONB NOT NULL DEFAULT '[]', -- [{team_id, score, method}] top-N
  occurrences      INT  NOT NULL DEFAULT 1,      -- nº de filas esperando → prioriza el panel
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | rejected
  resolved_team_id UUID REFERENCES teams(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (normalized, source_id)       -- una entrada por nombre desconocido, no una por partido
);
```

### 3.3 Cómo se mantiene intacto el historial de 10 años

- **Los partidos apuntan a `teams.id`, no a nombres.** `matches.home_team_id` es un UUID estable. Da igual que el club se llame "Coinasa", "Bergantiños" o "Deportivo" cada año: el `team_id` no se mueve, así que la ficha del equipo agrega 10 temporadas sin fisuras.
- **El patrocinio es una consulta temporal, no una identidad.** ¿Cómo se llamaba el Liceo en 2020-21? `SELECT commercial_name FROM club_names WHERE club_id=$1 AND $fecha BETWEEN valid_from AND COALESCE(valid_to,'infinity')`. Puedes pintar el nombre de época en las actas históricas y el nombre actual en la portada, sin duplicar entidades.
- **Género y categoría quedan aislados pero hermanados.** El Liceo masculino senior y el femenino senior son **dos `teams` distintos** (historiales independientes) que comparten `club_id` (misma entidad, mismo escudo, misma ciudad). La ficha de *club* puede federar sus secciones; la ficha de *equipo* mantiene su tabla y su racha propias.
- **Los filiales no contaminan al primer equipo.** "Liceo B" es `squad_level=2`: su descenso no afecta a la clasificación del A, pero cuelga del mismo club para navegación y escudo.
- **Multi-fuente sin merges destructivos.** Un club presente en FEP y en la fed. portuguesa tiene **dos filas en `source_entity_map`** apuntando al mismo `team_id`. Nunca duplicas la entidad; solo añades una vía de entrada.

---

## 4. Estrategia Human-in-the-Loop (HITL)

Regla de oro, aprendida de tu propio bug del Liceo: **ante la duda, NO se crea entidad nueva ni se fusiona; se aparca.** Un duplicado creado en automático cuesta un merge manual y arrastra actas; un ítem en cola cuesta un clic. La asimetría de coste manda toda la política.

### 4.1 Umbrales (calibrables)

| Confianza del mejor candidato | Acción | Quién |
|---|---|---|
| **≥ 0.95** y señales de dominio consistentes (misma ciudad **y** categoría **y** género) | Auto-confirmar: escribe `team_aliases` (`created_by='fuzzy'`) + registro auditable reversible | Máquina |
| **0.85 – 0.95** o señales parcialmente consistentes | A la cola con top-3 candidatos pre-rankeados | Humano (1 clic) |
| **< 0.85** o ≥2 candidatos empatados | A la cola marcada como *ambigua*; sin candidato por defecto | Humano |
| Sin ningún candidato razonable | A la cola como *entidad nueva probable* → crear club/team | Humano |

Las "señales de dominio" (ciudad, categoría, género, rival del partido, competición) son **más discriminantes que el propio nombre** y son las que evitan el falso positivo semántico. Un `similarity` de 0.9 con ciudad distinta vale menos que un 0.8 con ciudad idéntica.

### 4.2 Flujo del panel de moderación (sobre tu admin de Next ya existente)

1. **Bandeja priorizada por impacto:** la cola se ordena por `occurrences` (un alias que bloquea 200 partidos aparece antes que uno con 1). Resolver arriba desatasca el máximo de datos por clic.
2. **Tarjeta de resolución:** muestra el `raw_text`, el contexto del partido (competición, temporada, rival, ciudad inferida) y **top-3 candidatos con su score y su evidencia** ("mismo país, misma categoría, escudo parecido").
3. **Tres acciones de un clic:** `[Es <candidato>]` · `[Es un alias nuevo de otro club → buscador]` · `[Crear entidad nueva]`. Nada de formularios largos.
4. **Retroalimentación inmediata:** al confirmar, se escribe un `team_aliases` con `created_by='human:<user>'` y `confidence=1.0`. **La próxima vez ese nombre cae en el escalón 2 (match exacto) y jamás vuelve a la cola.** El sistema aprende con cada clic.
5. **Reproceso automático:** resolver un ítem de la cola dispara el re-linkado de todas las filas `occurrences` que esperaban por él (los partidos "huérfanos" se enganchan solos).
6. **Auditoría y reversa:** toda auto-confirmación y toda acción humana quedan en un log; un merge equivocado se revierte sin cirugía (por eso las entidades nunca se borran, se marcan).

### 4.3 El papel del LLM (barato y en su sitio)

El LLM **no está en el camino caliente**. Un job nocturno toma el backlog de `resolution_queue` que sigue `pending`, y en **una llamada batch** pide al modelo que, dado el `raw_text` + contexto + lista de candidatos, sugiera el más probable y una confianza. Eso **rellena `candidates`** para que el humano decida más rápido; nunca auto-confirma por sí solo salvo consenso con el fuzzy. Coste real = "entidades nuevas por temporada" (decenas), no filas escrapeadas (miles) → céntimos. Cumple tu restricción a rajatabla.

---

## 5. Veredicto y hoja de ruta (recomendación de CTO)

### 5.1 Veredicto: **Opción B — Híbrida en embudo.**

No porque sea la de moda, sino porque es la **única que respeta las tres verdades de tu proyecto a la vez**: (1) ya tienes IDs de fuente que resuelven gratis el 95% —hay que exprimirlos, no ignorarlos—; (2) tu restricción de coste prohíbe el LLM por fila —el embudo lo relega a un backlog minúsculo—; (3) tu punto de dolor real es el duplicado y el cruce inter-fuente PT/IT —el staging + HITL + `source_entity_map` multi-fuente atacan exactamente eso—. A se queda corta donde creces; C es infra cara para un problema (semántica de texto largo) que no tienes. B **es A bien hecha más las dos piezas que te faltan** (aprendizaje y humano en el bucle), y encaja en Postgres + Node/TS sin comprar nada.

### 5.2 Tech stack recomendado

- **Almacén y matching:** PostgreSQL 16 con `pg_trgm` (similitud de trigramas + índice GIN) y `unaccent`. Sin servicios externos en caliente.
- **Normalización determinista (TS, en el ETL):** `unaccent` → minúsculas → quitar puntuación → **quitar tokens de `sponsors`** → **quitar sufijos** de género/categoría/filial ("fem", "b", "juvenil"...) → colapsar espacios. Pura y testeable (encaja con tu patrón `push-diff`/`eu-timezone`: lógica sin BD, fijada con tests).
- **Bloqueo (blocking) para escala:** nunca compares todos contra todos. Filtra candidatos por **clave de bloqueo** (`country` + primera palabra significativa + `age_category` + `gender`) y solo entonces aplica `similarity()`. Mantiene el fuzzy en O(candidatos), no O(n²), incluso con miles de equipos.
- **Cola + panel:** tablas en Postgres (`resolution_queue`) y vista de moderación en tu **admin Next existente** (ya tienes `X-Admin-Token`). Reproceso disparado por `LISTEN/NOTIFY` (que ya usas para el directo) o por job del `etl-scheduler`.
- **LLM (diferido, opcional):** Batch API (coste ~50% menor que síncrono) sobre el backlog `pending`, solo para pre-rankear candidatos. `pgvector` queda como **posible escalón 3.b** de generación de candidatos si algún día el volumen inter-fuente lo pide — no antes.

### 5.3 Plan de implementación por fases

- **Fase 0 — Modelo (fundacional).** Introduce `clubs` / `club_names` / `sponsors` y reencuadra `teams` con `(gender, age_category, squad_level)`. Migra los `teams` actuales colgándolos de un `club` y volcando `source_ref`/`alt_source_refs` a `source_entity_map`. *Es la migración de más calado; hazla con la BD delante y por PR, como el resto.*
- **Fase 1 — Embudo determinista (escalones 1–2).** Pipeline de ingesta: resolver por `source_entity_map` y, si no, por `team_aliases.normalized` exacto. Aquí ya recuperas el 95%+ con coste cero. Función `normalize()` pura + tests.
- **Fase 2 — Fuzzy con bloqueo + cola (escalones 3–4).** `pg_trgm` acotado por clave de bloqueo, umbrales de la §4.1, y todo lo dudoso a `resolution_queue`. Panel HITL mínimo (bandeja por `occurrences` + 3 botones + reproceso).
- **Fase 3 — Aprendizaje y auto-confirmación.** Retroalimentación de aliases desde cada resolución (humana y automática); auto-confirmar solo con ≥0.95 + señales consistentes, siempre reversible y auditado. Métrica de salud: **% de filas que llegan a la cola** (debe decaer temporada a temporada).
- **Fase 4 — LLM en lote (bajo demanda).** Solo cuando PT/IT metan volumen inter-fuente real: job nocturno que pre-rankea el backlog. Evalúa `pgvector` como escalón de candidatos únicamente si el trigram+reglas se quedan cortos en el multilingüe — probablemente no haga falta.

**Orden de valor:** las Fases 0–1 te dan el 95% de la resolución con el 20% del esfuerzo y cero coste recurrente. La 2 elimina los duplicados. La 3 hace que el sistema mejore solo. La 4 es el seguro para la expansión internacional, y llega *cuando* haga falta, no antes.
