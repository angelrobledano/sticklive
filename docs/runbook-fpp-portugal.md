# Runbook — Portugal (FPP): ligas y copas

Fuente: https://hp.fpp.pt (Federação de Patinagem de Portugal). **No es sidgad**:
es un PHP propio renderizado en servidor, sin API.

| Página | Qué da |
|---|---|
| `/Competicao/{id}` | calendario completo (jornadas, fecha y hora local, marcador, enlace a la ficha) |
| `/Classificacao/{id}` | clasificación (P J V E D GM GS DG) y escudo `CLUBE_{clubId}.png` |
| `/jogo/{id}` · `/jogoTaca/{id}` | ficha (liga · copas): alineaciones con foto, técnicos, árbitros, faltas de equipo |
| `/Views/ajax_jogo.php?…&token=` | timeline: goles, penaltis, libres directos, tarjetas, faltas, tiempos muertos (el token sale de la ficha) |
| `/Direto` | partidos del día, se refresca cada 15 s (v3, directo) |

## Alcance

- **v1:** calendario, resultados y clasificación de las 18 secciones de 2026/27,
  agrupadas en 10 competiciones de Stick Live.
- **v2 (ficha):** alineaciones con foto y titulares, técnicos, árbitros, faltas
  de equipo y timeline completo de cada partido terminado.
- Sin directo todavía (v3).

| Competición | ids FPP |
|---|---|
| Campeonato Placard (1ª) | 493 |
| 2ª Divisão | 494 Norte · 495 Sul |
| 3ª Divisão | 498 Norte A · 499 Norte B · 500 Sul A · 501 Sul B |
| CN Feminino | 502 Norte · 503 Centro · 504 Sul |
| CN Sub-23 | 505 Norte · 506 Centro · 507 Sul |
| Supertaça / Supertaça F | 496 / 497 |
| Taça de Portugal | 508 (Pré-Eliminatória) |
| Elite Cup / Elite Cup F | 509 / 510 |

## Modelo

- **Un id de la FPP por fase y zona.** El catálogo
  (`apps/scraper/src/scrapers/fpp/fpp-catalog.ts`) agrupa varios ids en una
  competición: misma fase + distinto grupo = zonas (Norte/Sul…), fase distinta
  = fases sucesivas. `seed-fpp.ts` lo vuelca a `competition_sources.external_ids.fpp`
  y `run-fpp.ts` lee de la BD.
- **Equipos:** la ref es nombre + sección, `fpp_{m|f}_{edad}_{slug}`
  (`fpp_m_senior_sl-benfica`, `fpp_f_senior_sl-benfica`). Es única globalmente,
  así que el mismo equipo de liga se reutiliza en las copas. El club sale del
  escudo (`fpp_club_{id}`), estable entre temporadas.
- **Partidos:** `fpp_match_{idFPP}_{nº}`. El nº existe desde que se publica el calendario.
- **Hora:** local de Lisboa → UTC con `zonedToUtc('Europe/Lisbon')`.
- **Resultado:** la FPP pinta el marcador provisional en el calendario durante el
  partido. Solo se da por terminado cuando han pasado 150 min desde el inicio
  (`FINISHED_GRACE_MIN`). Nunca se declara "en juego" por reloj.
- **Cruces sin decidir** ("Vencedor Jogo 1557"): no generan partido. La ronda se
  crea igualmente y el partido aparece cuando la FPP publica los equipos.

## Ficha y timeline (v2)

`fpp-ficha.parser.ts` (puro) + `fpp-ficha.ts` (E/S). Corre al final de cada
`--run-once fpp`, después del calendario.

- **Qué partidos:** los FPP `finished` con ficha publicada que aún no tienen
  alineación, y los de las últimas 36 h como mucho cada 2 h (la FPP corrige
  actas). Máximo `FPP_FICHAS_MAX` (120) por pasada, 2 GET por partido.
- **Jugador = id federativo** de su foto (`FED_85963.jpg` → `fpp_player_85963`),
  el mismo en alineación y timeline: vinculación exacta, sin nombres. La foto
  se guarda tal cual: el verificador `update-player-photos` no toca las refs `fpp_`.
- **Lado:** visitante = fila alineada a la derecha (`justify-content-end`). El
  `alt` "Jogador Equipa 1/2" miente en las tarjetas a técnicos.
- **Crono:** tiempo restante de la parte, como en la FEP. Las partes que vienen
  tras "Prolongamento" son los periodos 3 y 4.
- **Tipos:** `Golo` → gol · `Golo Penalti` → gol + penalti marcado ·
  `Golo Livre Direto` → gol + libre directo marcado · `Penalti/Livre Direto
  Falhado` · `Cartão Azul/Vermelho` · `Falta N` (falta de equipo, sin jugador) ·
  `Desconto de Tempo`. El amarillo y la advertencia verbal no tienen equivalente.
- **Calidad de la fuente:** sobre 299 partidos de 2025/26, los goles del timeline
  cuadran con el marcador en el 93%. El resto son actas incompletas o goles
  duplicados en origen (los duplicados exactos se quitan). `refresh_event_coverage`
  marca esos partidos como `partial`.
- **source_url:** el upsert común de partidos no reescribe `source_url`, así que
  `run-fpp` la actualiza él mismo cuando aparece la ficha.

## Despliegue (primera vez)

El orden no importa: sin la migración, `--run-once fpp` no encuentra
competiciones y no hace nada.

```sh
cd /opt/sticklive && git pull
$DC run --rm api node dist/packages/db/src/migrate.js        # 087: fuente fpp_hockey + categoría sub23
$DC up -d --build
$DC exec etl node dist/apps/etl/src/seed-fpp.js               # dry-run: revisar equipos
$DC exec etl node dist/apps/etl/src/seed-fpp.js --write
$DC exec etl flock -n /tmp/etl-pipeline.lock node dist/apps/scraper/src/index.js --run-once fpp
```

A partir de ahí, el scheduler lo lanza **cada 15 min**, antes de cron-live.
Son unas 30 peticiones GET por pasada, con 400 ms de cortesía entre ellas.

Comprobación (en local se cargaron 1.561 partidos, 114 rondas, 141 clasificaciones y 141 equipos):

```sql
SELECT c.short_name, count(m.*) FROM competitions c
  JOIN seasons s ON s.competition_id = c.id AND s.is_current
  LEFT JOIN matches m ON m.season_id = s.id
 WHERE c.organizer = 'FPP' GROUP BY 1 ORDER BY 1;
```

## Alta de una fase nueva a mitad de temporada

La FPP crea un id nuevo para el playoff de la 1ª (1/4, 1/2, final), para cada
ronda de la Taça (32 avos, 16 avos…), para la Final Four, etc. Para darlo de alta:

1. Añadir la sección a la competición en `fpp-catalog.ts`. Para una eliminatoria:
   `cup('5xx', 'play-off', 'Play-Off')` (o una fase nueva en la Taça).
2. Desplegar y ejecutar `seed-fpp.js --write --only=<key>`. Crea los equipos nuevos y actualiza las secciones.

Para ver los ids de la temporada: `https://hp.fpp.pt/` (menú "Competições 2026/27").

## Pendiente / riesgos

- **Azores (HC Ponta Delgada…):** las Azores van una hora por detrás de Lisboa.
  Si la FPP publica la hora local de la pista y no la de Lisboa, esos partidos
  quedan desplazados 1 h. Hay que contrastarlo con un partido real en las Azores.
  Madeira tiene la misma hora que Lisboa.
- v3: directo con `/Direto` dentro de cron-live.
- Histórico (`/Historico`, épocas 2024/25 y 2025/26 accesibles).
