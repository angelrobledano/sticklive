# Paridad de marca entre web y app

Diseño aprobado para llevar la identidad de Stick Live (la i) a la interfaz de
`apps/web` y `apps/mobile` por igual. Los assets de tienda, los iconos nativos y
las imágenes OG ya estaban hechos; aquí se alinea la interfaz.

Fuentes: [`identidad.md`](./identidad.md) (concepto y reglas de la i),
[`publicacion-tiendas.md`](./publicacion-tiendas.md) (estado y pendientes),
[`store/README.md`](../../store/README.md) y [`DESIGN.md`](../../DESIGN.md).
Referencia visual ya aplicada: `apps/web/src/lib/og-brand.tsx`.

## 1. Tokens compartidos (`packages/brand`)

Fuente única de verdad en TypeScript. Cada `tailwind.config.ts` importa el
paquete; `og-brand.tsx` también. Ningún otro fichero define colores de marca.

| Token | Hex | Uso | Contraste (WCAG) |
|---|---|---|---|
| `granate` | `#9E1235` | primario | 8.1:1 sobre blanco · 2.3:1 sobre noche |
| `granateLight` | `#B91C1C` | hover en claro | 6.5:1 sobre blanco |
| `granateDark` | `#7F1D1D` | active/focus en claro | 10.0:1 sobre blanco |
| `accent` | `#F87171` | granate sobre superficie oscura | 6.8:1 sobre noche |
| `tinta` | `#1A0B12` | tinta del lockup en claro | 19.1:1 sobre blanco |
| `noche` | `#0B1220` | fondo oscuro | — |
| `live` | `#10B981` | solo punto de directo | 7.4:1 sobre noche |
| `liveDeep` | `#047857` | fondo badge «En directo» (texto blanco) | 5.5:1 sobre blanco |
| `amber` | `#F59E0B` | descanso/avisos | 2.2:1 (no apto para texto) |
| `amberDeep` | `#B45309` | fondo badge descanso (texto blanco) | 5.0:1 sobre blanco |

`src/tokens.test.ts` verifica los umbrales con un helper WCAG: granate AA sobre
blanco, `accent` ≥3:1 sobre noche, `liveDeep`/`amberDeep` AA con blanco y
`tinta` AA sobre blanco. Así un retoque futuro no rompe accesibilidad.

## 2. Reglas aplicadas en las dos plataformas

| Regla | Web | App |
|---|---|---|
| Acento (rojos de marca) | `tailwind.config.ts`, `globals.css`, hover/active de marca en error/not-found/premium/MatchesView/CompetitionsList/PremiumBanner | `tailwind.config.ts`, `(tabs)/_layout.tsx`, `settings/notifications.tsx`, `FollowButton.tsx`, `src/lib/push.ts` |
| Directo | badge verde + punto + «En directo» (mismo tratamiento en MatchHeader/MatchCard/MatchesView/LiveBoard/Knockout/Gameweeks) | badge verde + punto en MatchCard y `team/[id]` (hoy granate) |
| Logotipo | cabecera `Sidebar.tsx` y `login/page.tsx` → lockup de la i (`public/brand/`) | no hay isotipo en pantalla: la cabecera es de texto, como las capturas de tienda (la marca en app vive en icono y splash) |
| Modo oscuro | `themeColor` y `globals.css` a noche `#0B1220` | `rink-floor-dark` a noche + tema de navegación claro/oscuro |
| Gol 🏑 | icono de gol de `icons.tsx` → stick+bola | `EventRow.tsx` y `team/[id].tsx` |
| Push | `notification-copy.ts` `playerGoalAlert` 🏑 (sirve a web y nativo) | idem; **sin** `[Stick Live]` solo en el canal nativo (`push-dispatcher.ts`) |

Colores de **dato** que NO se tocan: anillo del equipo local (y `#dc2626`) en
alineaciones, rojo de tarjeta, diferencial de goles negativo, estados de error.

## 3. Fases (un commit por fase)

1. **Tokens** — `packages/brand/*`, los dos `tailwind.config.ts`, `og-brand.tsx`.
2. **Acento web y app** — remapeo de rojos de marca a token.
3. **Directo y logotipo** — badges en vivo unificados y lockup en cabeceras.
4. **Modo oscuro y navegación** — noche `#0B1220` y tema de navegación de la app.
5. **Gol y push** — 🏑 en interfaces y avisos; prefijo fuera del nativo.
6. **Iconos web** — `icon.svg`, `apple-icon.png`, `public/icon-*.png`,
   `theme_color` del manifest; borrar `public/og-image.png`.
7. **Splash** — `expo-splash-screen` para sustituir la clave `splash` heredada.

Específico de plataforma (fuera de la paridad): iconos web (fase 6) y splash de
la app (fase 7).

## 4. Decisiones tomadas

- **Paquete**: `packages/brand` (no `shared-types`: mezclar tokens de UI con el
  contrato de dominio difumina la frontera).
- **Nombre del token Tailwind**: se mantiene `rink-passion` apuntando al paquete
  (diff pequeño; la fuente única es `packages/brand`).
- **Variantes light/dark**: se reutilizan `#B91C1C`/`#7F1D1D` (ya cumplen AA);
  el granate sobre oscuro es `accent`.
- **Email** `mailer.ts`: entra como marca.
- **Icono de gol web**: stick+bola de la marca (coherente con el estilo SVG).
- **Logotipo en app**: **no** se añade a la cabecera. Las capturas de tienda
  muestran una cabecera de texto (no hay isotipo en pantalla), así que el
  logotipo de la i se aplica solo en la web; en la app la marca vive en el
  icono y el splash.
- **Cabeceras de la app**: se activa la cabecera del `Stack` raíz (con botón de
  volver) y se le pasa a expo-router un tema de navegación claro y otro oscuro.
  Las pantallas de ajustes mueven su título a la cabecera.
- **Sin footer nuevo** en la web (no existe hoy).
- **Prefijo de push**: `stripBrand` en el borde de entrega nativo.
- **DESIGN.md**: fuera de estas fases (paso 4 de `identidad.md`), pendiente.

## 5. Verificación

- `typecheck`, `lint` y `test` en verde para `packages/brand`, `apps/web`,
  `apps/mobile` y `apps/api` (y `apps/etl`, por el push).
- `npx expo config` carga sin errores.
- Capturas claras/oscuras lado a lado (home, partido en directo, clasificación,
  favoritos).
- Tabla de contraste AA con ratios (sección 1).
- `grep` final sin `#991b1b`, `#7f1d1d`, `#9f1239` ni el isotipo antiguo fuera
  de los colores de dato.
