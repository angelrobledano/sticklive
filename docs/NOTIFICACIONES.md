# Notificaciones push — cuándo y cómo se envían

*Actualizado: 17 de junio de 2026*

---

## Resumen en una frase

El emisor de directo (ETL) compara el estado de los partidos antes y después de cada ciclo; cuando detecta un **inicio de partido, gol, final, inicio/fin de jornada o gol de un jugador seguido**, envía una Web Push a cada dispositivo suscrito **cuyas preferencias lo pidan**, con una única notificación viva por partido que se va actualizando.

---

## Cuándo se envía cada notificación

| Evento | Disparador (diff entre ciclos) | Quién la recibe |
|---|---|---|
| **Inicio de partido** | `scheduled` → `live` | Seguidores de alguno de los dos equipos con *"Inicio de partido (favoritos)"* activo, **o** cualquiera con la alerta global *"Inicio de partido"* activada |
| **Gol** | El marcador de un lado sube mientras el partido está `live` | Seguidores de alguno de los dos equipos con *"Goles"* activo, **y** seguidores de la **competición** del partido. No hay alerta global de goles: sería spam |
| **Final** | cualquier estado → `finished` | Seguidores con *"Fin de partido (favoritos)"*, o cualquiera con la alerta global *"Fin de partido"* |
| **Gol de jugador seguido** | Aparece un gol con `player_id` de un jugador favorito | Seguidores de ese jugador con avisos del jugador activos |
| **Inicio de jornada** | El primer partido de una jornada pasa a `live` | Cualquiera con *"Jornadas"* activo (alerta global, sin segmentar por equipo) |
| **Fin de jornada** | El último partido de la jornada pasa a `finished` | Cualquiera con *"Jornadas"* activo |

Los avisos se emiten para **todas las competiciones senior y copas de la temporada** que el cron de directo vigila, no solo la OK Liga: la segmentación por *equipo*, *liga* y *jugador* favoritos los mantiene relevantes.

Copys (con la marca `[Stick Live]` delante):

- Inicio: `[Stick Live] HCL – IHC ¡en juego!` / cuerpo `[LIVE] HCL 0 - 0 IHC`
- Gol: `[Stick Live] ¡Gol de HCL! Sube el 1 - 0` / cuerpo `[LIVE] HCL 1 - 0 IHC`
- Final: `[Stick Live] Final: HCL 2 - 1 IHC. Ver resumen y estadísticas.`

Tocar la notificación abre la ficha del partido (o enfoca la pestaña si ya está abierta).

---

## Reglas anti-intrusión

1. **Smart bundling** — cada partido usa un `tag` único de Web Push (`match-{id}`): cada nueva alerta **reemplaza** a la anterior del mismo partido en la pantalla de bloqueo. Tres goles seguidos = una notificación actualizada, nunca tres apiladas.
2. **Silencio nocturno** — con *"Silenciar por la noche"* activo (lo está por defecto), entre las **23:00 y las 08:00** (hora española) no se emite nada.
3. **Interruptor maestro** — *"Permitir notificaciones"* en off corta absolutamente todo, sin tocar el resto de preferencias.
4. **Caducidad** — cada push lleva TTL de 1 hora: si el teléfono está apagado durante el partido, no recibe un aluvión de alertas viejas al encenderse.

---

## Granularidad y límites conocidos

- El emisor corre en el ciclo del scraper de directo (cada **~45 segundos** durante partidos en juego). Un gol llega con hasta ese retraso.
- Si caen **dos goles del mismo equipo entre dos ciclos**, se notifica una sola vez con el marcador ya acumulado (consecuencia natural del diff + bundling: el marcador mostrado siempre es el real).
- El gol en directo no incluye el nombre del goleador (el marcador en vivo de la fuente no lo da). El aviso de *gol de jugador seguido* se dispara cuando el evento ya trae `player_id`, lo que en la práctica ocurre al procesarse el acta; el gol del marcador en vivo sigue siendo anónimo.
- Los toggles de *tarjetas* y *tiempos muertos* de Ajustes se guardan, pero esos eventos aún no se emiten en directo (limitación de la fuente en vivo).
- **Ya emitidos** (antes pendientes): *inicio/fin de jornada* y *competición seguida*.

## On/off por entidad

Además de los toggles globales, el usuario puede silenciar **un equipo, una liga o un jugador concretos** sin dejar de seguirlo. La preferencia vive en `localStorage` (`rink-notif-disabled` → `{teams, leagues, players}`, ver `lib/notif-prefs.ts`) y se refleja en lo que el dispositivo envía a `push_subscriptions`: el emisor solo considera las entidades **activadas**. Útil para seguir un equipo en la app pero no querer que vibre el móvil en cada gol suyo.

La pantalla *Ajustes → Notificaciones → (Equipos / Ligas / Jugadores)* lista los favoritos de cada tipo con su interruptor individual.

## Botón de prueba

*Ajustes → Notificaciones* incluye **"Enviar notificación de prueba"**, que llama a `POST /push/test` (rate-limited) y devuelve un push inmediato al propio dispositivo. Sirve para confirmar de un vistazo que el permiso, la suscripción y el Service Worker funcionan, sin esperar a que haya un partido en juego. En iOS el botón solo aparece si la app está **instalada en la pantalla de inicio** (requisito de Apple para Web Push).

---

## Cómo funciona por dentro (arquitectura)

```
Ajustes (web) ── activa maestro ──► permiso navegador + Service Worker (sw.js)
      │                                        │
      │ POST /push/subscribe                   │ recibe push → showNotification(tag)
      ▼                                        ▲
push_subscriptions (BD)                        │
  endpoint + claves + preferencias             │ Web Push (VAPID)
  + favoritos del dispositivo                  │
      ▲                                        │
      │ re-sync en cada cambio          push-dispatcher (ETL)
      │ de toggle o favorito             snapshot → ciclo scraper → diff
      └────────────────────────────────  inicio/gol/final → segmentar → enviar
```

- **La suscripción no requiere cuenta**: funciona para usuarios anónimos. El dispositivo sincroniza sus preferencias y favoritos a `push_subscriptions` cada vez que cambian (toggle de Ajustes o estrella de favorito).
- **Autolimpieza**: si el push service devuelve 404/410 (permiso revocado, navegador desinstalado), la suscripción se borra de BD automáticamente.
- **Claves VAPID**: identifican al servidor ante los push services (Google/Mozilla/Apple). La pública va horneada en la web; la privada solo vive en `.env.prod`.
- **Requisito**: HTTPS. En local no hay push (el módulo es no-op silencioso sin clave VAPID).

---

## Matriz de preferencias (Ajustes → Notificaciones)

| Toggle | Efecto real hoy |
|---|---|
| Permitir notificaciones (maestro) | Suscribe/desuscribe el dispositivo. Sin esto, nada. |
| Goles (favoritos) | Goles de partidos donde juega un equipo seguido |
| Inicio de partido (favoritos) | Arranque de partidos de equipos seguidos |
| Fin de partido (favoritos) | Final de partidos de equipos seguidos |
| Inicio de partido (global) | Arranque de cualquier partido de la liga |
| Fin de partido (global) | Final de cualquier partido |
| Jornadas | Inicio y fin de jornada (global) |
| Competición seguida | Goles de cualquier partido de una liga favorita |
| Jugador seguido | Gol de un jugador favorito (cuando el evento trae `player_id`) |
| Silenciar por la noche | Sin alertas 23:00–08:00 |
| Tarjetas / Tiempos muertos | Se guardan; emisión pendiente (limitación de la fuente en directo) |

> El on/off **por entidad concreta** (un equipo/liga/jugador específico) es independiente de estos toggles globales — ver sección "On/off por entidad".
