# App móvil, lote 2: shell de 4 pestañas y deep links

Estado: Implementado (2026-11-05). Competición por slug: la pantalla resuelve el UUID con la respuesta de `/competitions/<slug>/seasons` (`competition.id`) y acepta `?season=` además de `?seasonId=`. Fuente: matriz de huecos (`claude/app-movil-matriz-huecos.md`, sección Navegación y shell). Decisión de Ángel: 4 pestañas como la web (Partidos, Competiciones, Buscar, Favoritos), Ajustes a un icono en la cabecera, Clasificación dentro de la competición.

## Problema

1. La app tiene pestaña de Ajustes y una pestaña oculta de Clasificación que la web no tiene.
2. Los enlaces universales están rotos para las URLs reales de la web. La web publica `/es/matches/<id>`, `/es/teams/<id>`, `/es/players/<id>`, `/es/competitions/<slug>` (con locale y en plural, la competición con slug). La app solo declara `/match`, `/competition`, `/team` y `/login` en el AASA de iOS (`apps/web/src/app/.well-known/apple-app-site-association/route.ts`) y en los intentFilters de Android (`apps/mobile/app.config.ts`), y expo-router no tiene rutas `matches`, `teams` ni `players`. Un enlace de la web compartido por WhatsApp no abre la pantalla correcta de la app.
3. El push abre `data.urlPath` con `router.push` directo (`apps/mobile/app/_layout.tsx`), así que cualquier ruta con forma web falla igual.

## Diseño

Un único mapeador puro `webPathToAppPath(input: string): string` en `apps/mobile/src/lib/deep-links.ts`, con tests, que traduce cualquier ruta o URL de sticklive.eu a una ruta de expo-router:

- Quita host, esquema y prefijo de locale (`es ca en pt fr it`), y acepta el singular heredado (`/match/x`, `/team/x`, `/competition/x`).
- `matches|match/<id>` → `/match/<id>`, `teams|team/<id>` → `/team/<id>`, `players/<id>` → `/player/<id>`, `competitions|competition/<key>` → `/competition/<key>` conservando `?season=`.
- `competitions` a secas y los hubs `competitions/country/<code>` y `competitions/federation/<slug>` → `/competitions` (pestaña) hasta que existan esas pantallas (lote 6).
- `favorites` → `/favorites`, `search` → `/search` conservando `?q=`, `settings` y `settings/notifications[/<kind>]` → `/settings` o `/settings/notifications`, `login` conserva su query (magic link).
- `clubs/<id>` y `seasons/<id>` → `/` por ahora (pantallas del lote 6), raíz → `/`. Cualquier otra cosa (admin, legal, about, premium/…) → `/`.
- Rutas que ya son de la app pasan sin cambios.

Se usa en `app/+native-intent.tsx` (`redirectSystemPath`, mecanismo oficial de expo-router para enlaces entrantes) y en el manejador de push de `_layout.tsx`.

Competición por slug: comprobar que la pantalla `competition/[id]` funciona con un slug (la API ya busca por id o slug en `routes/competitions.ts:243`). Si alguna llamada de la pantalla solo admite UUID, resolver el slug a id al cargar y documentarlo.

Shell:

- `(tabs)` queda con `index`, `competitions`, `search`, `favorites`. Se borra `(tabs)/standings.tsx` tras confirmar con grep que nada navega a ella (si algo lo hace, redirigir a la competición).
- `(tabs)/settings.tsx` pasa a `app/settings/index.tsx` como pantalla de stack con título `nav.settings`. Las subpantallas `settings/notifications|premium|ads-privacy` siguen igual.
- Icono de engranaje (`settings-outline`, accesible con etiqueta `nav.settings`) en `headerRight` de las pestañas con cabecera (Partidos, Competiciones, Favoritos) que hace `router.push('/settings')`. Buscar no muestra cabecera hoy: añadir el engranaje en su barra propia solo si encaja sin romperla, si no se omite allí.
- Cualquier `router.push('/settings')` o `/(tabs)/settings` existente se actualiza.

Enlaces de sistema:

- AASA: rutas con y sin locale para `matches`, `teams`, `players`, `competitions`, `favorites`, `search`, mantener las heredadas `/match/*`, `/competition/*`, `/team/*` y `/login*` con el token. Excluir `/admin*` explícitamente. Actualizar `routes.test.ts`.
- Android intentFilters: añadir las mismas rutas con `pathPattern` o `pathPrefix` por locale (sin `admin`), manteniendo `autoVerify`.

Fuera de alcance: recientes, pantallas de club, temporada y hubs, cambios visuales de las pestañas.

## Tareas

1. `deep-links.ts` con TDD (tabla de casos que cubra cada regla, locale, URL absoluta, query, barra final, mayúsculas en UUID tal cual).
2. `+native-intent.tsx` y push usando el mapeador. Test del manejador si hay arnés, si no, test del mapeador basta.
3. Shell de 4 pestañas, Ajustes en stack y engranaje en cabecera.
4. AASA, intentFilters y test de la ruta AASA.
5. VERIFY: tests y tsc de mobile y web, lint de mobile, `expo export --platform android`. Commit con autor Ángel y trailers. Marcar este documento como Implementado.
