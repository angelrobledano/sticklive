# Runbook — Entity Resolution (as-built)

*Estado real de lo desplegado. El diseño/plan está en [ARQUITECTURA_ENTITY_RESOLUTION.md](./ARQUITECTURA_ENTITY_RESOLUTION.md) y [SPEC_FASE0_MODELO_CLUBS.md](./SPEC_FASE0_MODELO_CLUBS.md).*

Resolución de entidades para separar la **identidad estable del club** de sus **secciones** (team = club × género × categoría × filial) y de sus **nombres volátiles** (patrocinio). Fases 0→3 completas y en producción.

---

## 1. Modelo (migraciones 044–046)

- **044** — `clubs` (identidad estable), `sponsors`, `club_names` (nombre comercial con vigencia), `source_entity_map` (ID de fuente → entidad, FK polimórfica club/team con `CHECK num_nonnulls=1`); + `teams.club_id` (nullable) y `teams.squad_level`.
- **045** — `team_aliases` (nombre normalizado → team; índice GIN de trigramas) = caché del escalón 2.
- **046** — `resolution_queue` (cola HITL: lo no resuelto con confianza, con candidatos y `occurrences`).

Todas aditivas e idempotentes. `teams.source_ref`/`alt_source_refs` **se conservan**: coexisten con `source_entity_map` hasta migrar el consumo.

---

## 2. Cascada del resolver (`apps/etl/src/loaders/ref-resolver.ts`)

`resolveTeam(ref, sourceId?, signals?)` resuelve en orden, con corte temprano:

1. **source_entity_map** — ID de fuente → team (determinista).
2. **Puente** `teams.source_ref`/`alt_source_refs`; al resolver aquí, alimenta source_entity_map para la próxima vez.
3. **slug** (nombre slugificado exacto).
4. **team_aliases** — nombre normalizado exacto (`normalizeTeamName()`, función pura testeada).
5. **fuzzy con bloqueo** (pg_trgm acotado por deporte):
   - **auto-confirmación (Fase 3)** sólo si similitud ≥0.95 **Y** señales consistentes (género+categoría de la competición) **Y** candidato inequívoco → resuelve y aprende (alias `created_by='fuzzy'`);
   - si no, **a la cola** (`resolution_queue`) con candidatos pre-rankeados.

Regla de oro: ante la duda, NO se fusiona; se aparca. Nunca se auto-confirma sin señales.

---

## 3. Panel HITL

- **Ruta web:** `/{locale}/admin/resolucion` (p. ej. `https://sticklive.eu/es/admin/resolucion`), protegida por `ADMIN_TOKEN` (mismo token que `/admin`).
- **Endpoints** (`apps/api/src/routes/admin.ts`, cabecera `X-Admin-Token`):
  - `GET /admin/resolution-queue?status=pending&limit=100` — bandeja por impacto (`occurrences`).
  - `GET /admin/resolution-queue/stats` — salud del embudo (backlog + aliases por origen).
  - `POST /admin/resolution-queue/:id/resolve` `{ teamId }` — asigna, marca resuelto y **aprende** (escribe alias `human`).
  - `POST /admin/resolution-queue/:id/reject` — descarta (ruido).
- Resolver un ítem escribe el alias → ese nombre entra por el escalón 2 la próxima vez y no vuelve a la cola.

---

## 4. Backfills (one-off, tras desplegar)

Scripts manuales (patrón `seed-*`), idempotentes y reversibles. Se corren **desde el PC con el túnel SSH abierto** (la imagen de prod no lleva `tsx`; ver [DEPLOY.md](./DEPLOY.md)):

```powershell
# túnel en otra terminal: ssh -i ~/.ssh/sticklive -L 5432:localhost:5432 root@167.233.94.156
npx tsx --env-file=.env apps/etl/src/backfill-clubs.ts          # 1 club por team (Fase 0.2)
npx tsx --env-file=.env apps/etl/src/backfill-team-aliases.ts   # alias del nombre de cada team (Fase 1)
```

Estado en prod (3/8/2026): **108 clubs = 108 teams** (1:1), **159 aliases** deterministas, cola vacía.

Revert disponible en código: `revertBackfillClubs()` (DELETE en orden, **NUNCA** `TRUNCATE clubs CASCADE` — arrastraría `teams`) y `revertBackfillTeamAliases()`.

---

## 5. Despliegue

Aditivo. Las migraciones 044–046 las aplica el servicio `migrate` en el `up`; ninguna reescribe datos (no requieren backup previo). Tras desplegar por primera vez, correr los backfills del punto 4 una vez.

---

## 6. Pendiente

- **Fase 4 — LLM en lote:** job nocturno que pre-rankea el backlog de la cola. Diferido *a propósito* hasta que PT/IT metan volumen inter-fuente real (hoy la cola está vacía).
- **PT/IT:** la expansión inter-fuente (federaciones con IDs propios, hora local) es la que activa de verdad el embudo (escalones 3–5) y da sentido a la Fase 4.
- Auto-confirmación hoy **no dispara en OK Liga** porque los teams de club tienen `gender/age_category` NULL (falla en cerrado, seguro); se activará cuando PT/IT pueblen esas señales.
