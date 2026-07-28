-- 042 · Zona horaria por competición (punto 3.3)
--
-- El scraper interpretaba las horas de la fuente en hora española clavada
-- (`madridToUtc`), asunción que se rompe con cualquier fuente que publique en
-- otra hora local — de ahí el incidente de TZ de junio. Con una zona IANA por
-- competición, el scraper convierte hora local → UTC con la zona correcta.
--
-- DEFAULT 'Europe/Madrid': todas las competiciones actuales son españolas, así
-- que el comportamiento no cambia. Sólo una competición con otra zona (una
-- federación fuera de España, una sede itinerante) se interpretará distinto.
--
-- Es la zona en la que la FUENTE publica sus horarios, no la de la sede del
-- partido (la sede normalizada, `venues`, es harina de otro costal).

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Madrid';

COMMENT ON COLUMN competitions.timezone IS
  'Zona horaria IANA en la que la fuente publica los horarios de esta competición. '
  'El scraper la usa para convertir hora local → UTC (scheduled_at). Default Europe/Madrid.';
