# Contenido generado con datos: revisión de F4 y plan

**Fecha:** 19/10/2026 · **Contexto:** F4-1/F4-2 de [AUDITORIA_SEO_2026-10-16.md](./AUDITORIA_SEO_2026-10-16.md) (commit `1d78317`) ya están en producción. Este documento revisa ese primer corte y propone el siguiente: datos e insights calculados que sirvan a la vez para SEO, retención y tiempo en página.
**Estado:** propuesta, sin código. Las cifras de ejemplo salen de los 146 partidos terminados del sitemap el 16/10/2026 y son ilustrativas.

---

## 1. Revisión de lo que hay

El resumen de competición (`CompetitionSummary.tsx`) cumple la regla de no inventar nada, pero como pieza de producto se queda corto.

**Contenido**
- Tres datos sueltos (líder, próximo partido, máximo goleador) sin contexto. "Líder · 9 pts" no dice tras cuántas jornadas ni con qué ventaja, y "próximo partido" elige el primero del calendario, no el más interesante.
- Los nombres salen crudos de la fuente: mayúsculas ("CLUB D'ESPORTS VENDRELL") y jugador con apellidos delante ("FERRER SANTACANA LLUIS"). "JORNADA 2" tampoco está traducido.
- Ningún dato enlaza: ni el líder a su equipo, ni el partido a su ficha, ni el goleador a la suya. Es la peor parte desde el punto de vista SEO, porque el bloque más visible de la página no reparte enlazado interno.

**Diseño**
- Va encima de la cabecera de la competición: el usuario lee el resumen antes de saber en qué competición está, y el H1 queda debajo del bloque.
- Es una lista de "Etiqueta: valor" en texto corrido. Todo pesa igual, no hay escudos ni números destacados, y a la vista se parece más a metadatos que a un contenido que invite a quedarse.
- En móvil el próximo partido parte en dos líneas por la fecha y la jornada pegadas al final.

**La previa de partido** (`MatchPreview.tsx`) está mejor resuelta (dos columnas, forma con puntos de color), pero tiene los mismos huecos: sin escudos ni enlaces, y el H2H se limita a la temporada cargada.

---

## 2. Qué queremos conseguir

1. **SEO.** Texto único por página que salga de datos reales y que responda búsquedas de cola larga ("goleadores OK Liga Plata Sur", "cuántos goles mete el Vendrell", "Vic Sant Just previa"). También más enlazado interno entre fichas.
2. **Retención y tiempo en página.** Motivos para volver cada jornada y para pasar de una ficha a otra: un dato que no conocías, un enlace al jugador que lo protagoniza, algo que se puede compartir.
3. **Confianza.** Ni un solo dato falso. Un insight equivocado ("solo el 30 % de los penaltis acaban en gol" porque el parser marca mal los fallados) hace más daño que no tener ninguno.

---

## 3. Qué datos tenemos (y cuáles no)

Por evento de partido tenemos tipo, periodo, minuto y crono, equipo, jugador y detalle. Los tipos son gol, penalti (marcado o fallado), falta directa (marcada o fallada), tarjeta azul, tarjeta roja, falta de equipo y tiempo muerto. Además: alineaciones con portero, titular, capitán, goles y asistencias, clasificación, calendario, fases y rondas, prórrogas y tandas de penaltis. En los 146 partidos terminados del 16/10 había 1.134 goles, 2.165 faltas, 177 azules, 7 rojas, 133 penaltis y 83 faltas directas, todos con periodo y crono.

**No tenemos** sede (nula en todos los partidos), árbitro fiable, edad de los jugadores ni **sanciones oficiales**. Esto último importa para lo que pides de "sancionados para esta jornada" (§4.4).

Ejemplos de lo que ya se puede calcular hoy:
- Media de goles por partido: 5,2 en Plata Sur, 7,3 en Bronce Norte y 10,3 en el Mundial Sub-19.
- Goles por parte: 526 en la primera y 606 en la segunda.
- Goles en los dos últimos minutos: 64 de 1.134.
- Remontadas (perdía al descanso y ganó): 4 de 146 partidos.

---

## 4. Catálogo de contenido

Cada insight es un generador puro: recibe datos de la temporada, devuelve un objeto tipado o nada si no cumple su umbral. El texto lo pone la plantilla de cada idioma. Ninguno escribe prosa libre ni usa IA.

### 4.1 Competición

| Insight | Ejemplo | Umbral para mostrarse |
|---|---|---|
| Estado de la liga | "Jornada 3 de 22. El Vendrell lidera con 9 puntos, 2 más que el segundo" | ≥ 1 jornada jugada |
| Partido destacado de la jornada | El cruce entre equipos más cerca en la tabla, o entre los dos primeros | ≥ 2 jornadas |
| Invictos y rachas | "El Vendrell es el único invicto", "3 derrotas seguidas del X" | racha ≥ 3 |
| Ataque y defensa | Equipo más goleador, menos goleado, media de la liga | ≥ 3 jornadas |
| Casa y fuera | Mejor local, mejor visitante, % de victorias locales de la liga | ≥ 4 jornadas |
| Tabla de goleadores ampliada | Top 5 con % de los goles de su equipo | ≥ 1 jornada |
| Eficacia a balón parado | % de penaltis y faltas directas convertidos en la liga y por equipo | ≥ 15 lanzamientos |
| Disciplina | Más azules, rojas de la temporada, faltas de equipo por partido | ≥ 3 jornadas |
| Momentos | Remontadas, goles en el último minuto, partido con más goles | cuando ocurren |

### 4.2 Equipo

Posición y tendencia (subió o bajó tras la jornada), forma y rachas, goles por parte ("marca el 60 % de sus goles en la segunda parte"), goles en los últimos 5 minutos, % de victorias cuando marca primero, dependencia del máximo goleador (por ejemplo "Ferrer ha marcado 5 de los 9 goles del equipo"), eficacia en penaltis y faltas directas, faltas por partido y cuántas veces llega a la décima (falta directa en contra), local frente a visitante.

### 4.3 Partido

**Previa:** lo que ya hay (posición, forma, H2H) más goles por parte de cada uno, cómo le va a cada equipo cuando marca primero, el máximo goleador de cada equipo con enlace, y el H2H de temporadas anteriores cuando el histórico esté cargado.

**Crónica de datos tras el partido:** hechos detectados en los eventos, nunca adjetivos sin respaldo. Por ejemplo remontada, hat-trick, gol decisivo en el último minuto, penalti o falta directa decisivos, primera victoria de la temporada, fin de una racha o portería a cero.

### 4.4 Disciplina y sancionados

Es lo más delicado, por tres motivos:
- Una roja en hockey patines no lleva una sanción automática fija: la decide el Comité de Competición.
- Las suspensiones por acumulación de azules dependen del reglamento de cada competición.
- Publicar "X no juega esta jornada" sin la fuente oficial es exactamente el tipo de dato falso que hay que evitar.

Propuesta en dos pasos:
1. **Ya (hechos):** "Expulsados en la última jornada" (tarjeta roja, con enlace al partido) y "más azules de la temporada". Es lo que pasó, no una predicción.
2. **Spike (½ día):** ver si sidgad publica las resoluciones del Comité o la lista de sancionados. Si las publica, se scrapean y se muestran como "Sancionados para la jornada N (fuente: RFEP)". Si no, "apercibidos por acumulación" solo cuando tengamos el reglamento de esa competición escrito en la base de datos, nunca deducido.

### 4.5 Jugador

Goles por partido, % de los goles de su equipo, penaltis marcados de lanzados, partidos seguidos marcando, hat-tricks, posición en la tabla de goleadores y, cuando haya muestra, percentil frente a los jugadores de su liga.

### 4.6 Dato curioso rotatorio

Un bloque "¿Sabías que…?" que elige uno de los insights que cumplen su umbral y tienen interés (§5.3). La rotación es **diaria y determinista** (semilla = entidad + fecha), no aleatoria en cada visita:
- Google ve el mismo contenido durante el día y no indexa un texto que cambia en cada rastreo.
- La caché del HTML sigue sirviendo.
- Quien vuelve al día siguiente encuentra algo distinto.

El resto de insights elegibles siguen en el HTML (en el bloque de estadísticas). La rotación solo decide cuál se destaca.

---

## 5. Diseño propuesto

### 5.1 Ficha de competición

Orden: cabecera (nombre, temporada, selector) → **"Así va la liga"** → pestañas.

```
┌ Así va la liga · Jornada 3 de 22 ─────────────────────────┐
│ [escudo] Vendrell        [escudo] Vic – Sant Just  [foto] Ferrer │
│ Líder · 9 pts            Mar 21 oct · 20:30         5 goles      │
│ +2 sobre el 2.º          Duelo 3.º contra 4.º       Pichichi     │
├────────────────────────────────────────────────────────────┤
│ 💡 ¿Sabías que…? El 60 % de los goles de Plata Sur llegan  │
│    en la segunda parte.                       [Compartir]  │
├────────────────────────────────────────────────────────────┤
│ 5,2 goles/partido · 38 % penaltis marcados · 1 invicto      │
└────────────────────────────────────────────────────────────┘
```

Los valores del boceto son ilustrativos: salen de la captura del 19/10 mezclados con cifras de ejemplo, no de un cálculo.

- Tres teselas iguales: líder, partido destacado y pichichi. Cada una es un enlace a su ficha y lleva escudo o foto. Las cifras van con la fuente de marcador (`score`/mono) y el contexto debajo en texto pequeño.
- "¿Sabías que…?" como banda propia, con botón de compartir que genera una imagen OG del dato (§6, fase 5). Es lo que más ayuda a retención y difusión.
- Una línea de cifras de la liga como chips que enlazan a la pestaña de estadísticas.
- Siguiendo DESIGN.md, el color de acento solo aparece en lo interactivo y en el directo. Las teselas son superficies neutras, no tarjetas con sombra cada una.
- En móvil: las teselas en carrusel horizontal con scroll-snap (la primera entera, la segunda asomando), y el dato curioso debajo.

### 5.2 Ficha de partido (previa y crónica)

- Previa: las dos columnas actuales con escudo y enlace, debajo "Claves del partido" con 2 o 3 insights del cruce, y el H2H con todas las temporadas disponibles.
- Crónica: tras el final, una línea de hechos encima del timeline ("Remontada: perdía 1-3 al descanso", "Hat-trick de Ferrer") con enlace al momento del timeline.

### 5.3 Qué se destaca: puntuación de interés

Cada generador devuelve una prioridad: rareza (un hat-trick vale más que un "líder"), recencia (de esta jornada antes que de la temporada), entidades con demanda (equipos y jugadores con impresiones en Search Console) y variedad (no dos insights del mismo tipo seguidos). Un insight que no supera su umbral de muestra no entra nunca.

---

## 6. Arquitectura

- **Dónde se calcula:** en la API, `GET /seasons/:id/insights` (y `/teams/:id/insights`, `/matches/:id/insights`). Devuelve objetos tipados `{ id, kind, scope, entities, values, sample, priority }` con las entidades ya enlazables (ids). Caché de 10 minutos e invalidación cuando el ETL termina una pasada de la temporada.
- **Texto:** plantillas por idioma en la web (`lib/insights/templates`), con los nombres de presentación curados (F3-2) y los enumerables traducidos. Nunca texto libre en la API.
- **Calidad:**
  - Cada generador lleva su test con fixtures.
  - Tests de coherencia: el líder del bloque es el primero de la tabla, y los goles del pichichi coinciden con su ficha.
  - Los insights que dependen de eventos solo se calculan si la cobertura de actas (`eventCoverage = full`) es de al menos el 80 % de los partidos jugados de esa temporada.
- **Antes de publicar el primer insight de balón parado:** auditar el parser de penaltis y faltas directas. 93 fallados frente a 40 marcados es una conversión del 30 %, sospechosamente baja para este deporte. Si hay un fallo, lo arreglamos antes de enseñar el porcentaje.
- **Nombres:** "FERRER SANTACANA LLUIS" sale con los apellidos delante. Es el mismo problema de partición de nombre ya visto en la auditoría (DQ-05) y bloquea cualquier insight con jugadores en titular.

---

## 7. Plan por fases

| Fase | Qué | Esfuerzo | Depende de | Criterio de aceptación |
|---|---|---|---|---|
| C0 | Rediseño del resumen actual: debajo de la cabecera, tres teselas con escudo, foto y enlace, contexto (jornada X de Y, ventaja), nombres de presentación y ronda traducida | M | F3-2 (nombres) | Todo dato del bloque enlaza a su ficha. Cero mayúsculas de la fuente. H1 antes del bloque |
| C1 | Auditoría del parser de penaltis y faltas directas, y del orden nombre/apellidos de jugador | S-M | — | Muestra de 30 actas contrastada a mano con la fuente |
| C2 | Motor de insights v1 en la API + 8 generadores de competición y equipo (§4.1, §4.2) + "¿Sabías que…?" diario | L | C1 | Tests por generador. Ningún insight bajo su umbral. Mismo dato destacado durante todo el día |
| C3 | Previa ampliada y crónica de datos del partido (§4.3) | M | C2 | Hechos verificables en el timeline del mismo partido |
| C4 | Disciplina: expulsados de la última jornada + spike de sanciones oficiales | S + spike | — | Solo hechos o fuente oficial citada |
| C5 | Compartir un insight como imagen (OG por insight) | M | C2 | Imagen < 1 s, datos iguales a la página |
| C6 | Insights de jugador y percentiles | M | C2 | — |

Orden recomendado: C0 y C1 en paralelo (C0 es visible ya, C1 desbloquea lo demás), después C2. C4 puede ir en cualquier momento porque no depende del motor.

---

## 8. Cómo lo medimos

PostHog:
- **Eventos nuevos:** `insight_viewed` (al entrar en viewport), `insight_clicked` y `insight_shared`, con `kind` y `scope`.
- **Línea base antes de C0:** tiempo de interacción en fichas de competición y partido, páginas por sesión, vuelta a 7 días.

Search Console: impresiones y clics de consultas de cola larga sobre competición, equipo y jugador, comparando 4 semanas antes con 4 semanas después de C2.

Objetivo razonable a 8 semanas de C2:
- +20 % de páginas por sesión en las fichas de competición.
- CTR del bloque de insights por encima del 5 %.
- Más consultas distintas con impresiones en `/competitions/` y `/teams/`.

Son hipótesis para validar, no compromisos.

---

## 9. Decisiones pendientes

1. ¿Rotación diaria o por jornada del "¿Sabías que…?"? Propongo diaria.
2. Sancionados: ¿esperamos al spike de fuente oficial o publicamos ya "expulsados en la última jornada"? Propongo publicar ya los hechos.
3. ¿Botón de compartir dato solo en web o también en la app? Propongo web primero, que es donde está el SEO.
