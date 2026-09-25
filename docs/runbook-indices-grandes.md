# Runbook — Índices sobre tablas grandes (match_events, match_lineups)

## Por qué existe este runbook

El runner de migraciones (`packages/db/src/migrate.ts`) manda cada `.sql` como
una sola cadena → **transacción implícita**. Dentro de una transacción,
`CREATE INDEX CONCURRENTLY` no puede ejecutarse. Y sobre una tabla
**particionada** (como `match_events` desde la 047), `CREATE INDEX CONCURRENTLY`
tampoco está soportado sobre la tabla padre.

Un `CREATE INDEX` normal sobre el padre toma un lock `ACCESS EXCLUSIVE` en cada
partición mientras construye el índice. Sobre `match_events` (1,49M filas) eso
**para las escrituras del directo** (el ETL inserta cada ~45 s vía
`replaceMatchEvents`) durante los segundos que dura el build. En una BD pequeña
(CI, dev) el lock es de milisegundos y da igual; en producción, no.

**Invariante operativa:** para crear un índice nuevo sobre `match_events` o
`match_lineups` en producción, se construye SIN bloqueo con el procedimiento de
abajo **ANTES** de desplegar la migración. La migración lleva `CREATE INDEX IF
NOT EXISTS`, así que al pasar después encuentra el índice ya creado y es un
no-op (sin lock). En CI/dev la misma migración crea el índice al vuelo.

## Procedimiento sin bloqueo (partición a partición)

El patrón estándar para índices lock-free en tablas particionadas:

1. Crear el índice en el **padre** con `ONLY` → índice inválido, no toca datos ni
   particiones, lock instantáneo.
2. Por cada partición: `CREATE INDEX CONCURRENTLY` (sin lock de escritura) y
   `ALTER INDEX <padre> ATTACH PARTITION <hijo>`.
3. Cuando TODAS las particiones están attachadas, el índice del padre pasa a
   `valid` automáticamente.

`CREATE INDEX CONCURRENTLY` **no** puede ir dentro de una transacción: ejecuta
cada sentencia suelta (psql en autocommit, no envolver en BEGIN/COMMIT).

### Ejemplo real: `idx_match_events_player` (migración 052)

Particiones de `match_events`: `match_events_s2001` … `match_events_s2035` y
`match_events_undated` (ver 047).

Contra la BD de producción (ajusta el `psql` a como se conecta en el VPS; ver
`reference_runtime_produccion` — prod corre compilado, pero esto es SQL directo):

```sql
-- 1) Índice padre INVÁLIDO (instantáneo, no bloquea escrituras).
CREATE INDEX idx_match_events_player
  ON ONLY match_events (player_id)
  WHERE player_id IS NOT NULL;
```

```bash
# 2) Una partición cada vez, sin lock de escritura. En bash, autocommit:
for y in $(seq 2001 2035); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mep_s${y} \
       ON match_events_s${y} (player_id) WHERE player_id IS NOT NULL;"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "ALTER INDEX idx_match_events_player ATTACH PARTITION idx_mep_s${y};"
done
# La partición centinela:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mep_undated \
     ON match_events_undated (player_id) WHERE player_id IS NOT NULL;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "ALTER INDEX idx_match_events_player ATTACH PARTITION idx_mep_undated;"
```

```sql
-- 3) Comprobar que el índice del padre quedó VÁLIDO (indisvalid = true):
SELECT c.relname, i.indisvalid
FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname = 'idx_match_events_player';
-- Si alguna partición quedó sin attachar, indisvalid = false: revisa el bucle.
```

### Si un `CREATE INDEX CONCURRENTLY` falla a medias

Deja un índice `INVALID` en esa partición. Hay que borrarlo y reintentar:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_mep_s2019;  -- la que falló
```

Luego repetir el `CREATE INDEX CONCURRENTLY` + `ATTACH` de esa partición.

## Después de desplegar la migración

Al aplicar la migración (052 en este caso), el `CREATE INDEX IF NOT EXISTS
idx_match_events_player` sobre el padre encuentra el índice ya creado y no hace
nada. El registro en `_migrations` queda igual que en CI. No hay divergencia de
esquema entre prod y "desde cero".

## Checklist para un índice nuevo sobre tabla grande

- [ ] La migración usa `CREATE INDEX IF NOT EXISTS` sobre el padre.
- [ ] Este runbook ejecutado en prod ANTES del deploy (padre `ONLY` + por
      partición `CONCURRENTLY` + `ATTACH`).
- [ ] `indisvalid = true` en el índice del padre.
- [ ] El job `migrations` del CI incluye el índice en "Verificar esquema".
- [ ] Nueva temporada: al crear la partición `match_events_sYYYY` del año
      siguiente (runbook de alta de temporada), crear también sus índices y
      attacharlos, o quedará sin cubrir.
