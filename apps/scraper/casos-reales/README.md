# Casos reales de la fuente

Páginas guardadas de las fuentes (calendarios SIDGAD de FEP y World Skate, feed de directo FEP,
match center de World Skate) y lo que la plataforma entiende de ellas. Es la red de seguridad del
parser de estructura y del estado del directo: si un cambio en el código o en la fuente altera cómo
se interpreta una competición real, la batería lo dice antes de llegar a producción.

La ejecuta `npm run test` (test `src/casos-reales/casos-reales.test.ts`), sin red ni base de datos.

## Qué hay en cada caso

```text
casos-reales/<caso>/
  caso.json       qué es, de dónde sale, cuándo se capturó y el FORMATO según las normas
  *.html          las páginas tal y como las sirvió la fuente
  esperado.json   el detalle aprobado: fases, rondas, cada fila del calendario / cada partido
```

Hay dos niveles de verdad, a propósito:

- **`formato`** (en `caso.json`) se escribe **a mano** a partir de las normas de la competición
  (Bases RFEP, reglamento de World Skate). No se regenera nunca. Notación:
  `liga → eliminatoria[cuartos,semis,final]·series → colocacion`, donde `·series` = al mejor de N
  (la fuente publica el 3.er partido) e `·ida-vuelta` = dos partidos que se resuelven por goles.
- **`esperado.json`** es el detalle completo y se **regenera**. Cada fila del calendario aparece como
  `fecha | etiqueta de la fuente → fase/ronda[/fase eliminatoria] [P nº de partido] | local-visitante`,
  así que un cambio de interpretación se lee directamente en el diff.

`debeContener` / `noDebeContener` (opcionales) fijan líneas concretas: por ejemplo, que el partido en
juego del sub-19 se lea como `live 1-11` a las 15:30 UTC (12:30 en Asunción) o que el femenino no se
lleve el `idp` de otra categoría.

## Flujo

**Cambié el parser y falla la batería.** Mira el diff del test. Si el cambio es el que buscabas,
acéptalo y revisa el diff de los `esperado.json` antes de commitear:

```bash
npm run casos:actualizar --workspace=apps/scraper
git diff apps/scraper/casos-reales
```

Si falla el `formato`, el parser entiende la competición distinto de lo que dicen sus normas: es un
fallo del código (o el formato del caso estaba mal escrito), nunca algo que se acepte regenerando.

**Competición nueva o formato nuevo.** Captúrala desde una máquina con acceso a la fuente (tu PC o
el servidor), completa `formato` según sus normas y acepta:

```bash
npx tsx apps/scraper/src/casos-reales/capturar.ts --caso=<nombre> --fuente=fep --idc=<idc>[,<idc>] --descripcion="…"
npx tsx apps/scraper/src/casos-reales/capturar.ts --caso=<nombre> --fuente=wse --idc=<idc> --zona=<IANA>
npx tsx apps/scraper/src/casos-reales/capturar.ts --caso=fep-feed-directo-<fecha> --fuente=fep --feed
```

Merece la pena capturar el feed y el match center **con partidos en juego**: son los casos que
prueban el directo.

**La fuente cambió su HTML.** Recaptura el caso afectado (`--sobrescribir`) y deja que la batería
enseñe qué cambia.

## Casos actuales (capturados el 08/10/2026)

| Caso | Qué prueba |
|---|---|
| `fep-ok-liga-masculina-2025-26` | Liga + Play Off por el título (series al mejor de 3/5) + Play Off 9.º-10.º; filas de nota de la fuente que no son partidos |
| `fep-playoff-ok-liga-femenina-2025-26` | Semifinales y final al mejor de 5 |
| `fep-copa-del-rey-2025-26` | Final eight (cuartos → semis → final) |
| `fep-supercopa-*`, `fep-copa-de-la-reina-2025-26` | Final four, también con la final aún sin finalistas |
| `fep-eliminatoria-doble-partido-3515/3516` | Ida y vuelta que la fuente rotula «Jornada 1/2» |
| `fep-feed-directo-2026-10-08` | Feed de directo FEP (estados y marcadores) |
| `wse-wsg-*` | Grupos + fase final + colocación de los WSG Asunción; estado y marcador desde el match center; `idp` sin cruzar categorías; hora de Asunción (UTC-3) |
