# Runbook — Euskadi (FVP) y Liga Norte

Fuente: https://www.fvpatinaje.eus/comp/hp (Federación Vasca de Patinaje). **No es
sidgad**: plataforma DigitalSport con API pública en JSON, sin autenticación.

| Endpoint (`/api…`) | Qué da |
|---|---|
| `/public/entity/{entidad}/competitions` | catálogo de todas las temporadas y deportes (HP, HL…) |
| `/hierarchy/competicion/{id}/divisiones` | divisiones (hoy, una por competición) |
| `/hierarchy/division/{id}/tree` | fases → jornadas → partidos (equipos, fecha, hora, pista, árbitros, goles) y cruces de copa |
| `/hierarchy/fase/{id}/clasificacion` | clasificación de una fase de liga |
| `/public/partidos/{id}` | acta: alineaciones con foto y dorsal, cuerpo técnico, incidencias con parte y crono |
| `/public/partidos/marcadores` | marcadores en directo de todo el hockey vasco (pendiente: directo, v2) |

La entidad de la FVP es `00000000-0000-4000-0000-000000000001`.

## Alcance (v1)

15 competiciones de 2026/27: Liga Norte (masculina, femenina, sub-23 y copa), Liga
Vasca (sénior, júnior, juvenil, veteranos) y las ligas escolares (infantil, alevín,
benjamín). Calendario, resultados, clasificación y actas cada 15 min
(`--run-once fvp` en el scheduler). Sin directo todavía.

## Modelo

- **Catálogo:** sale de la API, no hay lista fija. `seed-fvp.ts` lo lee, lo
  traduce (`fvp-catalog.ts`, puro) y lo guarda en `competition_sources.external_ids.fvp`.
- **Equipos:** la API da `equipoId` pero es la inscripción en esa competición
  (el C.P. Burgos tiene uno en la liga y otro en la copa). La identidad es
  nombre + ámbito, `fvp_{ámbito}_{slug}` (sin puntos: "SANTUTXU H.T." = "SANTUTXU HT").
  El ámbito es la liga, y la copa usa el de su liga. Si la copa escribe distinto un
  equipo ("R.S. TENIS" = "TENIS SANTANDER"), el seed lo enlaza por id de club si el
  club tiene un solo equipo en la liga (`nameAliases`).
- **No se fusiona con otras fuentes por nombre.** El seed avisa de los "posibles
  duplicados" (mismo nombre en RFEP, FNP…) para enlazarlos a mano en el admin.
- **Jugadores:** ref `fvp_player_{id de su ficha}`, que sale de la foto
  (`/affiliations/{uuid}.webp`). Sin foto, `fvp_player_pe_{plantillaEquipoId}`.
- **Hora:** fecha + hora local (Europe/Madrid). Sin hora, medianoche, como en sidgad.
- **Estado:** solo `FINISHED` cierra un partido. Un estado desconocido no toca el
  partido y va a Sentry (`fvp-estado`).

## Reglas del deporte escolar

- `maxDiferenciaGoles: 5`: el resultado oficial se corta (acta 3-11, oficial 3-8).
  Se guarda el oficial y los goles reales del acta. El partido queda con cobertura parcial.
- `marcadorACero`: benjamines sin marcador. La federación publica 0-0 a propósito y
  **no se cargan los goles del acta** (tarjetas y faltas sí).

## Despliegue (primera vez)

```sh
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
./deploy/deploy.sh                                   # aplica la 088 (fuente fvp_hockey)
$DC exec -T etl node dist/apps/etl/src/seed-fvp.js   # en seco: revisar equipos y posibles duplicados
$DC exec -T etl node dist/apps/etl/src/seed-fvp.js --write
$DC exec -T etl flock -w 1800 /tmp/etl-pipeline.lock node dist/apps/scraper/src/index.js --run-once fvp
```

En local (23/10) salieron 1.267 partidos, 100 terminados con acta, 919 jugadores y
5.000 eventos. Los goles del acta cuadran con el resultado en todos salvo los 13
cortados por la regla de los 5 goles.

## Pendiente

- Directo (v2): `/public/partidos/marcadores` en cron-live (una llamada para todo
  Euskadi) y, si hace falta, el canal Centrifugo `marcadores_{entidad}`.
- La Benjamín B tiene una jornada con fecha de 2027 (error de la fuente). El loader
  la rechaza por estar fuera de la temporada (#229). Se cargará sola cuando la corrijan.
- Equipos de la Liga Norte que ya existen por otras fuentes (Oberena e Iruña por
  la FNP, Burgos por la FPCYL…): enlazar a mano en el admin.
