-- Logo de competición (catálogo de la fuente: logos_competiciones/…).
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- La fuente (RFEP) ya publica "OK LIGA IBERDROLA"; el nombre interno se quedó
-- en "OK LIGA FEMENINA". El slug se mantiene para no romper URLs/histórico.
UPDATE competitions
   SET name = 'OK LIGA IBERDROLA',
       updated_at = NOW()
 WHERE slug = 'ok-liga-femenina'
   AND name <> 'OK LIGA IBERDROLA';
