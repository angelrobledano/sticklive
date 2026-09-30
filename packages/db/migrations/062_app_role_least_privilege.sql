-- ============================================================
-- 062 — Rol de aplicación con mínimo privilegio (#298).
--
-- Hasta ahora api y etl conectaban con el dueño del esquema (sports_user):
-- cualquier RCE/bug en el backend podía DROP/DDL sobre toda la base. Este rol
-- se limita al DML que la aplicación realmente hace.
--
-- Diseño:
--   · sticklive_app: LOGIN (sin password en la migración — la fija ops en el
--     servidor con ALTER ROLE ... PASSWORD, NUNCA en el repo) + DML sobre las
--     tablas existentes y futuras + USAGE de secuencias + CREATE de esquema
--     (el partition-guard diario crea particiones — es el único DDL legítimo
--     del runtime, documentado como excepción).
--   · migrate/DDL sigue con el dueño (sports_user): las migraciones necesitan
--     ALTER/CREATE sin límites.
--   · Los GRANT son tolerantes a entornos sin CREATEROLE (dev local): un
--     INSUFFICIENT_PRIVILEGE se avisa y se omite — en prod el dueño sí puede.
--   · DEFAULT PRIVILEGES para el dueño (sports_user): las tablas que creen
--     FUTURAS migraciones nacen ya legibles/escribibles por sticklive_app.
--
-- Rotación de credenciales: docs/database.md (§ rol de aplicación).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sticklive_app') THEN
    CREATE ROLE sticklive_app LOGIN;
  END IF;
EXCEPTION WHEN INSUFFICIENT_PRIVILEGE THEN
  RAISE NOTICE '062: sin permiso para crear el rol sticklive_app (entorno de dev) — se omite';
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sticklive_app', current_database());
  GRANT USAGE ON SCHEMA public TO sticklive_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sticklive_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sticklive_app;
  GRANT CREATE ON SCHEMA public TO sticklive_app;  -- particiones del partition-guard
  -- Sin FOR ROLE: aplica al rol que ejecuta las migraciones (el que crea las
  -- tablas futuras) — el mismo en prod, CI y dev.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sticklive_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO sticklive_app;
EXCEPTION WHEN INSUFFICIENT_PRIVILEGE THEN
  RAISE NOTICE '062: sin permiso para los GRANT (entorno de dev) — se omiten';
END $$;

COMMENT ON ROLE sticklive_app IS
  'Rol DML-only de api/etl (#298): sin DDL salvo CREATE de particiones (partition-guard). La password la fija ops con ALTER ROLE. Migrate/DDL sigue con el dueño del esquema.';
