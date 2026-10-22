# 06 · Comparación con fuentes oficiales

**Fecha de observación:** 21/10/2026 (UTC)
**Muestra:** 1 acta FECAPA profunda, 7 partidos RFEP agregados, 1 intento World Skate y 1 partido FISR en vivo.
**Confianza:** A para los datos observados; D para World Skate profundo.

---

## 1. Resumen

La comparación confirma una idea matizada:

- **En el resultado y el contexto, OKMob es fiable.** El acta FECAPA `164291` coincide en marcador, pabellón, árbitros, goleador, penalti, faltas directas, faltas de equipo y amarillas de banquillo. Los 7 resultados de la Jornada 4 de RFEP coinciden exactamente.
- **En la cronología completa, no es un espejo del acta oficial.** OKMob publica 4 eventos; el acta oficial contiene una secuencia mucho más larga con expulsiones de 2 minutos, tiempos muertos y otras acciones. Los contadores de tarjetas y faltas de los jugadores están a cero.
- **`P10` no es un bug.** El acta oficial también muestra `P10 00:00`; OKMob replica la nomenclatura de la fuente.
- **World Skate no se pudo verificar en profundidad.** El portal no abrió la competición y el acta directa quedó bloqueada por sesión/404. No hay evidencia de error, pero tampoco de fidelidad.

La conclusión práctica: OKMob es una buena fuente de **resultados**, no una fuente completa de **actas**. Cualquier producto que prometa «acta completa» debe medir la exhaustividad y explicarla.

---

## 2. Muestra FECAPA: Calafell 0–1 Barça

### 2.1 Contexto

| Campo | Valor |
|---|---|
| Competición | FRIT RAVICH LLIGA CATALANA (2026/27), `idc=4858` |
| Partido | CALAFELL LA MENORQUINA 0–1 BARÇA |
| Fecha/hora | 18/10/2026, 20:00 (Europe/Madrid) |
| Pabellón | POLIESPORTIU MUNICIPAL STA PERPETUA |
| Acta | `idp=164291` |
| Árbitros | David Calonge Barrio; Josep Oriol Escobar López |
| Estado | FINALIZAT; `P10 00:00` |
| Informe oficial | Creado el 20/10/2026 a las 22:33:21 GMT |

Fuentes:

- Portal oficial FECAPA: `https://www.hoqueipatins.fecapa.cat/league/4858`.
- Acta oficial (cargada por el portal; el fetch directo devuelve 0 bytes): `https://www.server2.sidgad.es/fecapa/fecapa_gr_164291_1.php`.
- OKMob: `https://push.okmob.app/acta.json?idp=164291&idc=4858`.
- OKMob (archivo): `https://live.okmob.app/arc/acta/164291/1b07bce2a1a06171.json`.

### 2.2 Comparación campo a campo

| Campo | Acta oficial | OKMob | Resultado |
|---|---|---|---|
| Marcador | 0–1 | `homeScore: "0"`, `awayScore: "1"` | Coincide |
| Pabellón | POLIESPORTIU MUNICIPAL STA PERPETUA | Mismo | Coincide |
| Árbitros | Calonge Barrio; Escobar López | Mismos | Coincide |
| Gol | Martí Casas Lozano, P2 06:55 | `type: goal`, P2 06:55, Casas | Coincide |
| Penalti | P1 07:59, Barça | `type: penalty`, P1 07:59, Casas | Coincide |
| Falta directa Barça | P2 10:36, Alabart | `type: fd`, P2 10:36, Alabart | Coincide |
| Falta directa Calafell | P2 06:00, Pujalte | `type: fd`, P2 06:00, Pujalte | Coincide |
| Faltas de equipo | 12–10 | `homeFouls: 12`, `awayFouls: 10` | Coincide |
| Amarilla banquillo local | Guillem Cabestany Vives | `yellow: 1` | Coincide |
| Amarilla banquillo visitante | Ricardo Ares Lozano | `yellow: 1` | Coincide |
| Periodo/reloj | `P10 00:00` | `clockPeriod: "P10"`, `clock: "00:00"` | Coincide |
| Eventos totales | Decenas de acciones (expulsiones, tiempos muertos, faltas, gol, penalti) | 4 eventos | **No coincide** |
| Tarjetas/faltas de jugador | Acciones de 2 minutos y sanciones | Todos los contadores a 0 | **No coincide** |

**Conclusión:** las 4 acciones que OKMob publica son correctas. Lo que falta es el resto de la cronología. No se observó un error de dato en lo publicado; se observó una **cobertura incompleta**.

### 2.3 Qué falta exactamente

El acta oficial incluye, además de las 4 acciones:

- Expulsiones de 2 minutos de jugadores de ambos equipos.
- Tiempos muertos.
- Otras faltas y acciones de juego.
- Posiblemente cambios de jugador y sanciones de banquillo.

OKMob no las publica en `events`; tampoco las refleja en los contadores `fouls`, `yellow`, `blue`, `red` de los jugadores. Los contadores de banquillo sí están.

**No se puede afirmar la causa** desde fuera:

- Puede ser una decisión de producto (mostrar solo hitos).
- Puede ser un límite del parser (no mapea las filas de expulsión).
- Puede ser una limitación de la fuente en ese partido concreto.

La FAQ dice que la cronología depende del detalle de la fuente. En este caso la fuente **sí** tiene detalle, así que esa explicación no cubre la diferencia. Es una **incógnita abierta** y un punto a verificar con más actas.

### 2.4 El caso `P10`

El encabezado del acta oficial muestra `P10 00:00`. OKMob devuelve `clockPeriod: "P10"` y `clock: "00:00"`. No es una invención ni un bug: es la nomenclatura de la fuente para el estado final. Cualquier comparación que marque `P10` como error está mal planteada.

### 2.5 Orden de los eventos

El array de OKMob llega así:

1. P1 07:59 — penalti.
2. P2 10:36 — falta directa.
3. P2 06:55 — gol.
4. P2 06:00 — falta directa.

No está ordenado por tiempo. La UI debe ordenar; no se verificó si lo hace. Un consumidor que renderice el array tal cual mostraría una cronología incorrecta.

### 2.6 Contrato del acta

El acta de OKMob **no incluye** `idp`, `idc` ni fecha. El recurso se entiende solo por la URL. Para archivo, auditoría o integración, es un contrato frágil: dos actas de partidos distintos podrían tener el mismo cuerpo si cambian los IDs. La versión `av` ayuda, pero no identifica el partido.

---

## 3. Muestra RFEP: Jornada 4 de `R3575`

### 3.1 Contexto

- Competición: `R3575`.
- Jornada: 4.
- Fuente oficial: portal RFEP en `https://www.hockeypatines.fep.es/league/R3575` (Sidgad).
- Fuente OKMob: `https://push.okmob.app/calendar.json?idc=R3575`.
- Calendario completo: 182 partidos; 66 con vídeo; 16 con `av`; 26 con marcador en el momento de la observación (el resto son futuros o sin acta).

### 3.2 Resultados

| Partido | Marcador oficial | Marcador OKMob | Resultado |
|---|---|---|---|
| Mollerussa – Vendrell | 3–4 | 3–4 | Coincide |
| Vic – Vilano | 4–2 | 4–2 | Coincide |
| Alcobendas – Alcoi | 1–4 | 1–4 | Coincide |
| Cerdanyola – Palafrugell | 5–0 | 5–0 | Coincide |
| Mataró – Manlleu | 3–0 | 3–0 | Coincide |
| Sant Esteve Sesrovires – Igualada | 5–8 | 5–8 | Coincide |
| Noia – Sant Just | 3–2 | 3–2 | Coincide |

**Resultado:** 7/7 marcadores correctos. Es una muestra agregada; no se compararon actas, alineaciones ni eventos.

### 3.3 Qué demuestra y qué no

- **Demuestra** que OKMob replica correctamente los resultados de esta jornada.
- **No demuestra** que TODAS las jornadas estén completas: el calendario tiene 182 partidos y solo 26 con marcador; el resto puede ser futuro o puede faltar.
- **No demuestra** fidelidad de actas: no se abrió el detalle de estos 7 partidos.

---

## 4. World Skate: limitación

### 4.1 Lo que se pudo ver

- `https://push.okmob.app/calendar.json?idc=W260` devuelve datos de la **Champions League de World Skate**.
- Ejemplo observado: un Porto–Liceo con 6–2.
- El portal oficial `https://wse.sidgad.com/league/W260` carga, pero **no abrió automáticamente la competición 260** en la sesión de navegador.

### 4.2 Lo que no se pudo ver

- El acta oficial de un partido concreto.
- Las rutas directas probadas:

| URL | Resultado |
|---|---|
| `https://www.server2.sidgad.es/worldskate/worldskate_gr_W3079_1.php` | 404 |
| `https://www.server2.sidgad.es/worldskate/worldskate_gr_3079_1.php` | 200, 0 bytes |

- No se pudo confirmar si el 404 es por prefijo, por sesión o porque el acta no existe.
- No se compararon eventos, alineaciones ni tarjetas.

**Confianza:** D. No hay evidencia de error de OKMob; tampoco de fidelidad profunda. La conclusión se limita al calendario.

### 4.3 Por qué es importante

World Skate es una de las tres fuentes declaradas. Si OKMob falla en el acta europea, su promesa de cobertura europea queda debilitada. Si acierta, es una ventaja frente a Stick Live. Con la evidencia disponible, **no se puede decidir**.

---

## 5. FISR: fuente no declarada

- `https://push.okmob.app/ticker?f=fisr` devuelve 898.847 bytes de HTML con el ticker de FISR.
- El bundle `x` incluye un partido en vivo:

```json
{
  "fx": "I1898|2026-10-21|5437|5558",
  "idc": "I1898",
  "idp": "I29687",
  "status": "live",
  "score": [0, 0],
  "home": "MOP",
  "away": "TRI-F"
}
```

- Acta en curso: `TEMPO 2`, `P2 15:00`, `fouls [1,0]`, `stale: false`.
- Competición del ticker: «SKATE ITALIA TROPHY - GIRONE A».

No se comparó con la fuente oficial italiana. Los términos, «Sobre» y FAQ **no mencionan FISR**. Es una brecha de transparencia, no una prueba de infidelidad.

---

## 6. Tabla de discrepancias

| # | Hallazgo | Evidencia | Impacto | Confianza |
|---|---|---|---|---|
| 1 | Resultado y contexto FECAPA correctos | Acta 164291 | Bajo | A |
| 2 | Cronología FECAPA incompleta | 4 eventos vs acta oficial | Alto para «acta completa» | A |
| 3 | Tarjetas/faltas de jugador a cero | Acta 164291 | Alto si el usuario espera acta | A |
| 4 | Eventos desordenados | Array P1/P2 | Medio (contrato/UI) | A |
| 5 | `P10` es oficial | Acta oficial | Ninguno | A |
| 6 | Acta no autodescrita | Sin `idp`/`idc`/fecha | Medio (integración) | A |
| 7 | RFEP 7/7 resultados | Jornada 4 R3575 | Bajo | A |
| 8 | World Skate sin acta profunda | Portal/404 | Medio (cobertura) | D |
| 9 | FISR no declarada | Términos + ticker | Medio (transparencia) | A |
| 10 | Colisión de namespace | `idc=260` vs `W260` | Alto (integradores) | A |
| 11 | Esquemas inconsistentes | `homeScore` vs `score` | Medio (integración) | A |
| 12 | Sin campo de exhaustividad | Sin `complete`/`sourceDetail` | Alto (confianza) | A |

---

## 7. Qué implica para Stick Live

### 7.1 No usar OKMob como fuente

Los términos de OKMob prohíben el scraping. Además, su acta es incompleta. Stick Live debe seguir usando los portales oficiales de Sidgad como fuente de verdad.

### 7.2 Medir la exhaustividad

Stick Live debería añadir a su modelo:

- `source_detail_level`: `summary`, `digital`, `full`.
- `events_complete`: booleano.
- `events_expected` / `events_observed`.
- `source_url` y `source_fetched_at`.
- Un badge «acta resumida» cuando falten acciones.

Así el usuario sabe qué está viendo y el producto no promete más de lo que tiene.

### 7.3 Completar el modelo de eventos

El check de `match_events` en Stick Live admite `goal`, `penalty`, `blue_card`, `red_card`, `timeout`, `period_end`, `foul`, `direct_foul`. **No admite `yellow_card`**. Si se quiere representar el acta completa, hay que añadir:

- `yellow_card` (jugador y banquillo).
- Eventos de banquillo con `role`/`person`.
- Posiblemente `player_change`, `shot`, `save` si el acta los trae.

No todos son necesarios para el MVP; pero la ausencia de `yellow_card` es una laguna concreta frente al acta oficial.

### 7.4 Test de fidelidad

Crear un fixture con el acta `164291` y afirmar:

- Marcador 0–1.
- 2 faltas directas.
- 1 gol y 1 penalti.
- Faltas de equipo 12/10.
- Amarillas de banquillo 1/1.
- Periodo `P10`.
- Orden cronológico.
- Conteo de eventos y tipos.

Si el parser no puede reproducir el acta completa, el test debe fallar de forma explícita, no silenciosa.

### 7.5 Enlaces a la fuente

Añadir un enlace «ver acta oficial» en la ficha de partido. Es barato, aumenta la confianza y diferencia a Stick Live de un visor opaco.

---

## 8. Evidencias

| Evidencia | URL / artefacto | Fecha | Confianza |
|---|---|---|---|
| Acta OKMob 164291 | `https://push.okmob.app/acta.json?idp=164291&idc=4858` | 21/10/2026 | A |
| Archivo OKMob | `https://live.okmob.app/arc/acta/164291/1b07bce2a1a06171.json` | 21/10/2026 | A |
| Portal FECAPA | `https://www.hoqueipatins.fecapa.cat/league/4858` | 21/10/2026 | A |
| Acta oficial FECAPA | `https://www.server2.sidgad.es/fecapa/fecapa_gr_164291_1.php` | 20–21/10/2026 | A (vía portal) |
| Calendario RFEP | `https://push.okmob.app/calendar.json?idc=R3575` | 21/10/2026 | A |
| Portal RFEP | `https://www.hockeypatines.fep.es/league/R3575` | 21/10/2026 | A |
| Portal World Skate | `https://wse.sidgad.com/league/W260` | 21/10/2026 | A |
| Acta World Skate | `worldskate_gr_W3079_1.php` / `worldskate_gr_3079_1.php` | 21/10/2026 | D |
| Ticker FISR | `https://push.okmob.app/ticker?f=fisr` | 21/10/2026 | A |
| Documento `x` FISR | `https://live.okmob.app/live/x/100b9e666a099cdb.json` | 21/10/2026 | A |

---

## 9. Incógnitas

- ¿La diferencia de cronología es un límite del parser o una decisión de producto?
- ¿Ocurre en todas las actas o solo en algunas competiciones?
- ¿World Skate tiene el mismo nivel de detalle que FECAPA?
- ¿FISR se ingiere con la misma calidad que las otras federaciones?
- ¿OKMob conserva el acta oficial completa en algún almacenamiento interno, aunque no la publique?
- ¿El array de eventos se ordena en la UI? No se verificó.
- ¿La fecha de creación del acta oficial (20/10) implica una actualización posterior a la publicación de OKMob (18/10)? No se puede saber si OKMob la recibió o no.
