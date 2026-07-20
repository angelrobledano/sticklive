-- ============================================================
-- 037 — Índice para la purga de scrape_logs.
--
-- `scrape_logs` es un registro de auditoría del scraping en el que cada loader
-- escribe una fila por ejecución. Crece sin límite y NADIE lo lee:
-- `getLastScrapeLog` existe en packages/db pero no tiene consumidores.
--
-- Con el planificador actual son ~1.000 filas al día (cuatro por ciclo de World
-- Skate cada 5 min, más las de cron-live en sus bucles de 45 s durante los
-- partidos). La purga la hace packages/db/scripts/purge-scrape-logs.ts, que
-- corre a diario desde deploy/etl-scheduler.sh.
--
-- El único índice existente es (scraper_key, scraped_at DESC): sirve para
-- buscar por scraper, pero no para barrer por fecha, que es lo que hace la
-- purga. De ahí este.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_scrape_logs_scraped_at
  ON scrape_logs(scraped_at);

COMMENT ON TABLE scrape_logs IS
  'Auditoría del scraping. Se conservan 30 días (SCRAPE_LOGS_RETENTION_DAYS); la purga diaria la hace packages/db/scripts/purge-scrape-logs.ts desde el etl-scheduler. Tabla de solo escritura: si algún día se consulta, revisar antes la retención.';
