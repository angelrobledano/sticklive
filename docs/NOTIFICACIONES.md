# Notificaciones push — cuándo y cómo se envían

*Actualizado: 6 de octubre de 2026*

> Este doc describe el canal **Web Push** (navegador). La app móvil usa además el canal **nativo** (Expo Push → FCM/APNs) para la misma segmentación y con ledger de resumen matinal **por canal** (`push_summary_log.channel`: web y nativo no se bloquean ni duplican). Arquitectura completa del canal nativo en [docs/app.md](app.md).

---

## Resumen en una frase

El emisor de directo (ETL) compara el estado de los partidos antes y después de cada ciclo y, tras procesar el acta, detecta **inicio de partido, gol (con goleador y minuto), descanso, inicio de 2ª parte, expulsión, final, e inicio/fin de jornada**, y envía una Web Push a cada dispositivo suscrito **cuyas preferencias lo pidan**, con una única notificación viva por partido que se va actualizando.

---

## Cuándo se envía cada notificación

| Evento | Disparador | Quién la recibe | Momento |
|---|---|---|---|
| **Inicio de partido** | `scheduled` → `live` | Seguidores de un equipo (favMatchStart) **o** global (globalMatchStart) | pre-fichas (marcador) |
| **Gol** | Nuevo evento de gol en el acta (goleador + minuto) | Quien sigue el **equipo del goleador, la competición O al jugador** — un solo push (favGoals) | **post-fichas** |
| **Descanso** | `live_is_halftime` pasa a true | Seguidores de equipo/liga (favMatchStart) | post-fichas |
| **Inicio 2ª parte** | sale del descanso a periodo ≥ 2 | Seguidores de equipo/liga (favMatchStart) | post-fichas |
| **Expulsión (roja)** | Nuevo evento `red_card` en el acta | Seguidores de equipo/liga/jugador (favRedCards, default ON) | post-fichas |
| **Final** | cualquier estado → `finished` | Seguidores (favMatchEnd) o global (globalMatchEnd) | pre-fichas (estado) |
| **Inicio de jornada** | El primer partido de la jornada pasa a `live` | Global (globalJornadaStart) | — |
| **Fin de jornada** | El último partido pasa a `finished` | Global (globalJornadaEnd) | — |

Los avisos cubren **todas las competiciones que el cron de directo vigila** (no solo OK Liga); el gol, la roja y la fase se diffean sobre **todas las temporadas activas** a la vez.

### Copys (con la marca `[Stick Live]` delante en el canal web)

El canal **nativo** (Expo Push) entrega el mismo título **sin** la firma
`[Stick Live]`: el sistema ya muestra el nombre de la app junto al aviso
(`stripBrand` en `toExpoMessage`).

- Inicio: `[Stick Live] HCL – IHC ¡en juego!` · cuerpo `[LIVE] HCL 0 - 0 IHC`
- **Gol**: `[Stick Live] 🏑 ¡Gol de Pascual! IHC 2 - 1 HCL (12')` · cuerpo `[LIVE] IHC 2 - 1 HCL`
- **Descanso**: `[Stick Live] Descanso · IHC 2 - 1 HCL`
- **2ª parte**: `[Stick Live] ¡Comienza la 2ª parte! IHC 2 - 1 HCL`
- **Expulsión**: `[Stick Live] Tarjeta roja para {jugador} ({equipo}) al minuto 18'`
- Final: `[Stick Live] Final: IHC 3 - 2 HCL. Ver resumen y estadísticas.`

Tocar la notificación abre la ficha del partido.

---

## Diseño clave (por qué el gol va post-fichas)

El marcador en vivo (`rfep_mc_1.php`) da el resultado pero **no el goleador**; el goleador y el minuto vienen de la **ficha (acta)**, que el cron procesa después en cada ciclo. Por eso el **gol, la expulsión y la fase (descanso/2ª parte) se emiten DESPUÉS de las fichas** (`diffGoals` / `diffRedCards` / `diffPhase`), comparando un snapshot tomado **antes** de las fichas con el estado **después**. El **inicio** y el **final** dependen solo del estado/marcador (del feed `mc`), así que se emiten antes, en `diffAndNotify`.

**Deduplicación**: el gol usa un único `tag` por partido (`match-{id}`) y se envía **una sola vez por gol** a quien siga el equipo, la liga o el jugador. Quien seguía equipo + jugador a la vez ya **no** recibe dos notificaciones (antes sí).

---

## Reglas anti-intrusión

1. **Smart bundling** — `tag` único por partido (`match-{id}`): cada alerta reemplaza la anterior del mismo partido. Tres goles seguidos = una notificación actualizada.
2. **Silencio nocturno** — con *"Silenciar por la noche"* activo, entre las **23:00 y las 08:00** (hora española) no se emite nada.
3. **Interruptor maestro** — *"Permitir notificaciones"* en off corta todo.
4. **Caducidad** — TTL de 1 hora por push.

---

## Límites conocidos (pendientes)

- **Latencia**: el cron sondea cada **~45 s** durante partidos en juego y el gol espera al procesado del acta de ese ciclo → el aviso llega con ese retraso + el de publicación de la fuente (típico **1–3 min**). Objetivo de mejora: sondeo a 15–20 s. (Audit P1.)
- **Sin ledger de idempotencia**: el dedup vive en memoria del proceso del cron. Un reinicio a mitad de partido puede perder o repetir un evento justo en el borde. (Audit P1.)
- **Inicio de partido** puede no dispararse si el partido aparece directamente como `live` (creado en runtime) en vez de `scheduled → live`. (Audit P1.)
- **Aún NO se emiten**: tarjeta **azul** (toggle existe, default off, sin emisión), **tiempo muerto**, y **penalti señalado/fallado** (un penalti transformado cuenta como gol y sí se notifica; el señalado o el fallado no).
- Si caen **dos goles en el mismo ciclo**, se emiten ambos (uno por gol).

---

## Matriz de preferencias (Ajustes → Notificaciones)

| Toggle (clave config) | Default | Efecto real hoy |
|---|---|---|
| Permitir notificaciones (master) | on | Suscribe/desuscribe. Sin esto, nada. |
| Goles (`favGoals`) | on | Gol con goleador+minuto de equipo/liga/jugador seguidos |
| Tarjetas rojas (`favRedCards`) | **on** | Expulsiones de favoritos — **ya emitido** |
| Tarjetas azules (`favBlueCards`) | off | Guardado; **emisión pendiente** |
| Inicio de partido favoritos (`favMatchStart`) | on | Arranque + **descanso + 2ª parte** de favoritos |
| Fin de partido favoritos (`favMatchEnd`) | on | Final de favoritos |
| Inicio de partido global (`globalMatchStart`) | on | Arranque de cualquier partido |
| Fin de partido global (`globalMatchEnd`) | on | Final de cualquier partido |
| Jornadas (`globalJornadaStart`/`End`) | start on | Inicio/fin de jornada (global) |
| Competición seguida (`fav_leagues`) | — | Gol/roja/fase de una liga favorita |
| Jugador seguido (`fav_players`) | — | Gol/roja de un jugador favorito |
| Silenciar por la noche (`quietNight`) | off | Sin alertas 23:00–08:00; a la mañana siguiente (08:00–12:00) llega **un único resumen agrupado** con los finales de la noche (#272, ledger #383) |
| Tiempos muertos | — | Guardado; **emisión pendiente** |

> El **descanso y la 2ª parte** van bajo `favMatchStart` (si quieres el inicio, quieres las transiciones de fase). El on/off **por entidad concreta** (un equipo/liga/jugador) es independiente de estos toggles — ver "On/off por entidad".

---

## On/off por entidad

Además de los toggles globales, el usuario puede silenciar **un equipo, una liga o un jugador concretos** sin dejar de seguirlo. La preferencia vive en `localStorage` (`rink-notif-disabled`, ver `lib/notif-prefs.ts`) y se refleja en lo que el dispositivo sincroniza a `push_subscriptions`: el emisor solo considera las entidades **activadas**.

La pantalla *Ajustes → Notificaciones → (Equipos / Ligas / Jugadores)* lista los favoritos con su interruptor individual.

## Botón de prueba

*Ajustes → Notificaciones* incluye **"Enviar notificación de prueba"** (`POST /push/test`, rate-limited): push inmediato al propio dispositivo para confirmar permiso + suscripción + Service Worker. En iOS solo aparece con la app **instalada** en la pantalla de inicio.

---

## Arquitectura (resumen)

```
Ajustes (web) ─ master ─► permiso navegador + Service Worker (sw.js)
      │ POST /push/subscribe                         │ push → showNotification(tag)
      ▼                                              ▲
push_subscriptions (BD): endpoint + claves +          │ Web Push (VAPID)
  preferencias + favoritos                            │
      ▲ re-sync en cada cambio                push-dispatcher (ETL, en cron-live)
      └─────────────────────  snapshot (pre-fichas) → fichas → diffGoals/diffRedCards/diffPhase
                              + diffAndNotify (inicio/final/jornada) → segmentar → enviar
```

- Suscripción **sin cuenta** (anónimos incluidos); el dispositivo sincroniza preferencias y favoritos.
- **Autolimpieza**: 404/410 del push service → se borra la suscripción.
- **Observabilidad**: fallos del dispatcher se capturan en **Sentry** (servicio `etl`).
- Claves VAPID: pública horneada en la web, privada solo en `.env.prod`. Requiere HTTPS (en local es no-op).

---

## Historial de cambios

- **22/06/2026**: gol con goleador+minuto y deduplicado (equipo/liga/jugador, un push); expulsión (roja) emitida; descanso y 2ª parte emitidos; gol/roja/fase sobre todas las temporadas activas. Auditoría previa en `AUDITORIA_NOTIFICACIONES_2026-06-21.md`.
