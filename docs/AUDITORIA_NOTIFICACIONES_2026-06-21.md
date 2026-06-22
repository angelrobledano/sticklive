# Auditoría del sistema de notificaciones en tiempo real

**Fecha:** 21/06/2026 · **Contexto:** final OK Liga Igualada (IHC) vs Liceo (HCL), idp 34259.
**Alcance:** código en producción de Web Push. La auditoría refleja el sistema **actualmente desplegado** — el push (`push-dispatcher.ts`, `notification-copy.ts`, `sw.js`) NO está tocado por el deploy pendiente de hoy.
**Método:** auditoría de código (qué se emite y qué no, copy, dedup, timing) + predicción de cobertura sobre los eventos reales de este partido. La cronología empírica (hora de recepción real en el móvil) requiere tus observaciones — ver §2.

---

## 1. Resumen ejecutivo

El sistema emite notificaciones para **inicio de partido, gol, final, inicio/fin de jornada y gol de jugador favorito**. Funciona el "smart bundling" (una notificación viva por partido vía `tag`) y la segmentación por favoritos (equipo/liga/jugador) con silencio nocturno. Es una base sólida y limpia.

Pero como sistema "de directo serio" tiene **carencias graves de cobertura y calidad** que lo dejan por debajo de Flashscore/Sofascore:

- **Hallazgo crítico 1 — La notificación de gol no dice quién ni cuándo.** Al seguidor de un equipo le llega "¡Gol de IHC! Sube el 2-1", sin goleador ni minuto. El goleador solo llega a quien sigue a ESE jugador concreto. El minuto **no se incluye en ninguna notificación** (el campo existe pero nunca se rellena), pese a que ahora tenemos el cronómetro.
- **Hallazgo crítico 2 — Cobertura incompleta.** No hay notificación de **descanso, inicio de 2ª parte, tarjeta (azul/roja), expulsión, tiempo muerto ni penalti señalado/fallado**, aunque todos esos eventos se capturan en `match_events`. La función `cardAlert()` existe pero no se invoca en ningún sitio (código muerto).
- **Hallazgo crítico 3 — Doble notificación por gol.** Quien sigue al equipo Y al goleador recibe DOS pushes por el mismo gol (tag de partido + tag de jugador), ambos con `renotify`.
- **Hallazgo crítico 4 — Goles simultáneos / inicio de partidos creados en vivo se pierden.** Si los dos equipos marcan en el mismo ciclo solo se emite un push; y los partidos que aparecen directamente como `live` (como esta final) **no disparan el push de inicio**.
- **Hallazgo importante — Latencia.** El cron sondea cada ~45 s y depende del retraso de publicación de la fuente → la notificación llega típicamente **1–3 min** tarde. Flashscore/Sofascore están en ~5–30 s.

En una frase: **lo que llega es fiable y poco intrusivo, pero llega tarde, dice poco, y se deja fuera la mitad de los momentos que importan.**

---

## 2. Cronología del partido

La hora real del evento y la hora de recepción en el móvil solo las tienes tú. Para completar esta tabla con datos reales:

- VPS (lado de emisión): `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f etl | grep -E "Push despachadas|gol-jugador"` → da la hora de DESPACHO.
- Móvil: anota la hora de recepción de cada push.
- TV/retransmisión: anota la hora real de cada jugada.

Pégame esas tres y te calculo retraso real por evento. Mientras, aquí está la **cobertura predicha** según el código, sobre los eventos reales de este partido (de tu volcado):

| Evento real | Min (crono) | ¿Notifica hoy? | Qué llegaría |
|---|---|---|---|
| Inicio partido / 1ª parte | — | ❌ No (creado directo en `live`) | nada |
| Gol IHC 1-0 (Pascual) | P1 23:03 | ✅ Sí (gol) | "¡Gol de IHC! Sube el 1-0" (sin goleador ni minuto) |
| Gol IHC 2-0 (Pascual) | P1 20:46 | ✅ Sí | "¡Gol de IHC! Sube el 2-0" |
| Tarjeta azul IHC (Llanes) | P1 11:51 | ❌ No | nada |
| Gol HCL 2-1 (Cervera) | P1 12:04 | ✅ Sí | "¡Gol de HCL! Sube el 2-1" |
| Descanso | — | ❌ No | nada |
| Inicio 2ª parte | — | ❌ No | nada |
| Gol HCL 2-2 (Torres) | P2 21:04 | ✅ Sí | "¡Gol de HCL! Sube el 2-2" |
| Gol IHC 3-2 (González) | P2 17:09 | ✅ Sí | "¡Gol de IHC! Sube el 3-2" |
| Gol IHC 4-2 (González) | P2 14:11 | ✅ Sí | "¡Gol de IHC! Sube el 4-2" |
| Tiempos muertos (varios) | — | ❌ No | nada |
| Amonestación verbal | P2 15:06 | ❌ No (correcto, bajo valor) | nada |
| Final del partido | — | ✅ Sí (si no es franja nocturna) | "Final: IHC x-y HCL. Ver resumen y estadísticas." |

Latencia esperada de cada ✅: hasta ~45 s del ciclo de sondeo + retraso de publicación de la fuente (variable, a menudo 30 s–2 min).

---

## 3. Problemas detectados (por gravedad)

### Crítico

1. **Gol sin goleador ni minuto para seguidores de equipo.** `diffAndNotify` llama `goalAlert(teamShort, null, ref)` → "Sube el H-A". El goleador real (de las fichas) y el minuto (cronómetro) existen en BD pero no se usan. Es el evento más importante y el copy es el más pobre.
2. **Doble push por gol.** Un gol puede generar `goal` (tag `match-<id>`) en `diffAndNotify` y `playerGoal` (tag `player-<id>`) en `diffPlayerGoals`. Quien sigue equipo y goleador recibe dos, ambos con `renotify: true`.
3. **Cobertura nula de tarjetas, expulsiones, descanso, 2ª parte, tiempo muerto, penalti.** Eventos capturados pero nunca notificados. `cardAlert()` es código muerto.
4. **Inicio de partido no se dispara en partidos creados directamente en `live`.** El push de inicio exige transición `scheduled→live` con snapshot previo; los partidos que aparecen ya en vivo (caso de esta final) no lo tienen → sin aviso de arranque.

### Alto

5. **Goles simultáneos colapsan en uno.** Si en un mismo ciclo `homeDiff>0` y `awayDiff>0`, solo se emite el del local (`homeDiff>0 ? home : away`). Se pierde un gol.
6. **Latencia 1–3 min.** Sondeo de 45 s + retraso de la fuente. Lejos del estándar del mercado.
7. **Desincronización marcador↔goleador.** El marcador llega del feed `mc` y el goleador de las fichas, en pasos distintos del ciclo (a veces ciclos distintos) → el push de gol "de equipo" y el "de jugador" pueden separarse segundos/minutos.
8. **Sin registro de entregas (idempotencia).** El dedup vive solo en memoria del proceso del cron. Si el cron reinicia a mitad de partido (p. ej. un deploy), un evento que caiga justo en el reinicio puede perderse; tampoco hay defensa contra reemisión si cambiara la lógica de snapshot.

### Medio

9. **Resumen matinal no cableado.** `morningSummary()` existe pero no se llama: un partido que acaba tras las 23:00 con silencio nocturno **pierde** el aviso de final (no se compensa por la mañana).
10. **Falso gol por corrección de marcador.** Si el `mc` devuelve momentáneamente un marcador alto y luego corrige, se dispara un push fantasma (sin debounce/confirmación). Las correcciones a la baja no avisan (cambio de estado silencioso).
11. **Identificación de equipo por abreviatura.** "¡Gol de IHC!" usa el `short_name`; si es null cae a "Local"/"Visitante". Poco claro frente a "¡Gol del Igualada!".
12. **`[Stick Live]` en cada título.** Ocupa espacio en la pantalla de bloqueo y es redundante (el icono ya marca).
13. **Gol de jugador solo en la temporada primaria.** `diffPlayerGoals` solo corre para la primaria; en competiciones secundarias en vivo no hay push de jugador (asimetría).

### Bajo

14. **Sin acciones ni media en la notificación.** El `sw.js` no define `actions` (p. ej. "Ver partido"/"Silenciar este partido") ni imagen (escudos). Notificación plana.
15. **Jornada inicio/fin global** puede ser ruido de bajo valor si se activa con muchas competiciones.

---

## 4. Quick wins (alto impacto / bajo esfuerzo)

1. **Goleador + minuto en el push de gol de equipo.** Emitir el gol DESPUÉS de las fichas y usar el goleador real + el minuto del cronómetro. Convierte "Sube el 2-1" en "⚽ Gol de Pascual (Igualada) · 2-1 · 2'". *(El dato ya existe tras los cambios de hoy.)*
2. **Unificar gol en un único push.** Si el usuario sigue equipo y goleador, mandar una sola notificación (la rica, con goleador) y suprimir la de equipo para ese usuario. Elimina el duplicado.
3. **Notificar descanso, 2ª parte y final de parte** con `live_is_halftime`/`live_period` (datos ya disponibles). Texto: "Descanso · IHC 2-1 HCL".
4. **Notificar roja/expulsión** (la tarjeta de mayor valor); activar `cardAlert()` que ya está escrita.
5. **Arreglar el push de inicio** para partidos vistos por primera vez en `live` (tratar "primer avistamiento en vivo" como inicio, con guardia anti-reemisión).
6. **Quitar el prefijo `[Stick Live]`** del título (deja sitio al contenido; el icono ya marca).
7. **Nombre de club completo** en el copy de gol (usar `clubName`, no la abreviatura).
8. **Manejar goles simultáneos**: recorrer ambos lados y emitir un push por cada gol real del ciclo.

## 5. Mejoras estratégicas

- **Bajar la latencia**: ciclo de sondeo a 15–20 s mientras hay directo (hoy 45 s); a medio plazo, emitir en cuanto cambia el marcador sin esperar el resto del ciclo. Objetivo < 30 s.
- **Ledger de entregas** (`match_event_notifications`): exactamente-una-vez, dedup persistente y robustez ante reinicios. Base para cualquier mejora seria.
- **Paridad de cobertura con el mercado**: gol con goleador+minuto, roja, penalti (señalado/marcado/fallado), descanso/FT, recordatorio pre-partido ("tu equipo juega hoy / en 15 min"), final con goleadores.
- **Notificaciones ricas**: escudo del equipo como imagen, botones de acción ("Ver partido", "Silenciar este partido"), niveles de importancia (gol/roja = alta; tiempo muerto = baja/opt-in).
- **Directo persistente**: iOS Live Activities / notificación "ongoing" en Android con marcador + cronómetro autoactualizable (ahora que tenemos el reloj en vivo).
- **Control de saturación**: silenciar partido concreto, modo resumen/digest, throttling por importancia, y cablear el `morningSummary` para los partidos nocturnos.

---

## 6. Benchmark vs Flashscore / Sofascore / OneFootball

**Qué hacemos mejor**
- Smart bundling real (una notificación viva por partido que se actualiza en sitio) — más limpio que el apilado de algunas apps.
- Silencio nocturno integrado.
- Segmentación fina por entidad (equipo / liga / jugador) con switches por bloque.

**Qué hacemos peor**
- Latencia (ellos ~5–30 s; nosotros ~1–3 min).
- Cobertura: ellos notifican gol con goleador y minuto, roja, descanso, FT, penaltis, alineaciones, inicio; nosotros nos dejamos casi todo salvo gol/final.
- Calidad del copy del gol (sin goleador ni minuto).
- Sin notificaciones ricas (escudos, acciones) ni Live Activity.

**Funcionalidades que faltan y deberían incorporarse**
- Gol con goleador + minuto (paridad básica del mercado).
- Roja / penalti / descanso / FT.
- Recordatorio pre-partido y "tu equipo juega hoy".
- Live Activity / notificación ongoing con marcador+crono.
- Acciones e imagen en la notificación.

---

## 7. Lista priorizada de acciones

| # | Problema | Impacto | Esfuerzo | Prioridad | Recomendación |
|---|---|---|---|---|---|
| 1 | Gol sin goleador/minuto | Alto | Bajo | **P0** | Emitir gol tras fichas con goleador + minuto del crono |
| 2 | Doble push por gol | Alto | Bajo | **P0** | Unificar: un push por gol; suprimir el de equipo si llega el de jugador |
| 3 | Sin descanso / 2ª parte / FT | Alto | Bajo | **P0** | Notificar transiciones de fase con `live_is_halftime`/`live_period` |
| 4 | Sin roja/expulsión | Alto | Bajo | **P0** | Activar `cardAlert()` para roja (azul opt-in) |
| 5 | Inicio no dispara en partidos creados en vivo | Alto | Medio | **P1** | Tratar primer avistamiento en `live` como inicio, con guardia |
| 6 | Goles simultáneos se pierden | Medio | Bajo | **P1** | Emitir un push por cada gol real del ciclo |
| 7 | Latencia 1–3 min | Alto | Medio | **P1** | Ciclo a 15–20 s en directo; luego emisión inmediata |
| 8 | Sin idempotencia/ledger | Medio | Medio | **P1** | Tabla de entregas para exactamente-una-vez y dedup persistente |
| 9 | Resumen matinal no cableado | Medio | Bajo | **P2** | Cablear `morningSummary` para finales nocturnas |
| 10 | Falsos goles por corrección | Medio | Medio | **P2** | Debounce/confirmación del marcador antes de emitir |
| 11 | `[Stick Live]` + abreviatura | Bajo | Bajo | **P2** | Quitar prefijo; usar nombre de club completo |
| 12 | Penalti / tiempo muerto | Bajo | Medio | **P3** | Penalti señalado/marcado/fallado; tiempo muerto opt-in |
| 13 | Sin acciones/media | Bajo | Medio | **P3** | Botones ("Ver", "Silenciar") + escudo como imagen |
| 14 | Live Activity / ongoing | Alto | Alto | **P3** | Notificación viva con marcador+crono (gran diferenciador) |

**Recomendación de arranque:** P0 1–4 son medio día de trabajo y, juntos, suben el sistema de "avisa de goles sin contexto" a "te cuenta el partido". Hazlos en el mismo PR. Luego P1 (inicio fiable, latencia, ledger) para robustez.
