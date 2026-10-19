# Informe de equipos duplicados y vacíos — 19/10/2026

**Fuente:** PostgreSQL de producción (`teams`, `matches`, `team_players`), consulta de solo lectura.
**Objetivo:** preparar F1-11 sin fusionar ni modificar datos.

## Resumen

| Métrica | Equipos |
|---|---:|
| Total | 346 |
| Sin partidos | 4 |
| Sin plantilla | 200 |
| Sin partidos ni plantilla | 4 |
| Sin género o categoría de edad | 214 |

## Equipos sin partidos ni plantilla (4)

| ID | Nombre | Género | Categoría | País |
|---|---|---|---|---|
| `a8917ae1-081b-46bb-9347-89b0b16fec11` | Egipto | male | senior | EG |
| `d1fb4c96-eca7-4bdd-98bc-1183705c3bc8` | HOCKEY CLUB CORUÑA | ? | ? | ES |
| `d52913ab-1212-41c0-a6ba-782cbdb7260a` | India | male | senior | IN |
| `749f0a40-b1cf-4960-aff8-31dc7084bd80` | Mozambique | male | senior | MZ |

No se propone borrar ninguna: las selecciones pueden aparecer en una competición futura y `HOCKEY CLUB CORUÑA` necesita revisar sus referencias de fuente antes de fusionar.

## Grupos con el mismo nombre normalizado

La consulta devuelve 20 grupos. Los de selecciones son **esperados** y se resuelven con `display_name`/género/categoría (F3-2/F3-4), no fusionando:

- España (5), Francia (5), Italia (5), Portugal (5), Suiza (4), Argentina (3), Colombia (3), India (3), Alemania (2), Andorra (2), Brasil (2), Chile (2), Inglaterra (2).

Los siguientes grupos de clubes son **candidatos a duplicado** porque uno de los dos registros no tiene género/categoría:

| Nombre normalizado | IDs y nombres |
|---|---|
| adiss hockey rivas | `72171ec7-06e7-4f5b-b158-9436ebce98d8` (male/senior) · `7b3bf2b1-18eb-4f18-8aa1-2e6aaac81546` (?/?) |
| cdm hockey patines | `ff349048-184e-4865-8944-0cd7f764e1c5` (?/?) · `3566e95f-9536-4677-8238-c85b72bc26e6` (male/senior) |
| cerdanyola club d'hoquei | `bc9450e4-a324-45b4-a50a-851e8d4a5c1a` (?/?) · `66eec095-0739-4c1e-99af-e690baf37865` (female/senior) |
| ch mataró | `4db4f4ca-8ed5-42d6-90e8-86f0f23e1680` (female/senior) · `3a04af06-65cd-4ed6-bf45-86def6fe0c66` (?/?) |
| club patin alcobendas | `e446a6c7-03c1-4e5a-b173-fa3ad8e1909d` (?/?) · `0e3ec055-5eb9-43c4-b485-9f183c2ecce9` (male/senior) |
| club patin las rozas | `6c6c643f-1fc0-4b24-b9f0-8677016bc004` (?/?) · `8ad49eaf-3314-464f-ac12-02c55a2e00aa` (female/senior) |
| club promoción patín raspeig | `0ced3f57-e49f-4ca6-a306-f3130fa2cb2f` (female/senior) · `c54f8f96-8bbe-401e-a882-e0c3f9e61653` (?/?) |

Antes de fusionar hay que comprobar `source_ref`/`source_entity_map` y que no sean equipos distintos (filial, categoría o género). La fusión debe dejar redirección 308 mediante `entity_redirects`; no borrar directamente.

## Acciones recomendadas

1. Rellenar `gender`/`age_category` en los 214 equipos que faltan; es la causa principal de que selecciones y clubes compartan título.
2. Revisar los 7 grupos de clubes de la tabla y fusionar solo los que compartan club y categoría.
3. Mantener las selecciones separadas y resolver su nombre visible con `display_name` + género/categoría (F3-2/F3-4).
4. No borrar los 4 equipos vacíos sin revisar antes sus referencias de fuente.

## SQL utilizado

```sql
-- Equipos sin partidos ni plantilla
WITH team_matches AS (
  SELECT home_team_id AS id FROM matches
  UNION SELECT away_team_id FROM matches
), team_roster AS (
  SELECT DISTINCT team_id AS id FROM team_players
)
SELECT t.*
  FROM teams t
 WHERE NOT EXISTS (SELECT 1 FROM team_matches m WHERE m.id = t.id)
   AND NOT EXISTS (SELECT 1 FROM team_roster r WHERE r.id = t.id);

-- Grupos por nombre normalizado
SELECT lower(regexp_replace(name, '\s+', ' ', 'g')) AS normalized_name,
       count(*), string_agg(id::text || ' | ' || name, E'\n' ORDER BY name)
  FROM teams
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY count(*) DESC, normalized_name;
```
