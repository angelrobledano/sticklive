# Notificaciones push — cuándo y cómo se envían

*Actualizado: 11 de junio de 2026*

---

## Resumen en una frase

El scraper de directo compara el estado de los partidos antes y después de cada ciclo; cuando detecta un **inicio de partido, un gol o un final**, envía una Web Push a cada dispositivo suscrito **cuyas preferencias lo pidan**, con una única notificación viva por partido que se va actualizando.

---

## Cuándo se envía cada notificación

| Evento | Disparador (diff en BD) | Quién la recibe |
|---|---|---|
| **Inicio de partido** | `scheduled` → `live` | Seguidores de alguno de los dos equipos con *"Inicio de partido (favoritos)"* activo, **o** cualquiera con la alerta global *"Inicio de partido"* activada |
| **Gol** | El marcador de un lado sube mientras el partido está `live` | Solo seguidores de alguno de los dos equipos con *"Goles"* activo. No hay alerta global de goles: sería spam |
| **Final** | cualquier estado → `finished` | Seguidores con *"Fin de partido (favoritos)"*, o cualquiera con la alerta global *"Fin de partido"* |

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
- El gol no incluye aún el nombre del goleador (el marcador en vivo de la fuente no lo da; el acta detallada llega después del partido).
- Los toggles de *tarjetas* y *tiempos muertos* de Ajustes se guardan, pero esos eventos aún no se emiten en directo (misma limitación de fuente). El de *inicio/fin de jornada* tampoco — candidato a resumen programado futuro.

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
| Silenciar por la noche | Sin alertas 23:00–08:00 |
| Tarjetas / Tiempos muertos / Jornadas | Se guardan; emisión pendiente (limitación de la fuente en directo) |
