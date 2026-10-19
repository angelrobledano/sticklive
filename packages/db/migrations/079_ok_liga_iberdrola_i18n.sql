-- La traducción ES antigua pisaba el nombre nuevo ("OK Liga Femenina").
UPDATE competitions
   SET name_i18n = jsonb_set(name_i18n, '{es}', '"OK Liga Iberdrola"'::jsonb),
       updated_at = NOW()
 WHERE slug = 'ok-liga-femenina'
   AND name_i18n ? 'es'
   AND name_i18n->>'es' <> 'OK Liga Iberdrola';
