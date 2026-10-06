# App móvil M1 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear `apps/mobile` (Expo SDK 57 + expo-router + NativeWind) con las 5 tabs navegables, el tema de la web y CI en verde.

**Architecture:** Workspace npm dentro del monorepo Turborepo existente (se recoge automáticamente por `apps/*` y las tareas genéricas de `turbo.json`). Expo Router para navegación por ficheros, NativeWind para estilos con los tokens de `DESIGN.md` (los tokens viven en un módulo TS único que alimenta Tailwind y el tema nativo). Pantallas placeholder sin datos — los datos reales llegan en M2.

**Tech Stack:** Expo SDK 57 (estable publicado en npm), React Native, expo-router, NativeWind 5 (verificar docs instalados — el setup puede diferir del de v4), TypeScript, vitest, ESLint flat config del repo.

**Referencias:**
- Spec: `docs/superpowers/specs/2026-10-05-app-movil-design.md`
- Tokens de diseño: `DESIGN.md` (bloque frontmatter, líneas 4-57)
- Convenciones: `AGENTS.md` raíz (typecheck+lint+test en verde antes de mergear)

**Advertencia de versiones:** `npx create-expo-app@latest` instalará SDK 57 (verificado: `expo@57.0.27` latest en npm, NativeWind `5.0.0`). Los snippets de configuración de NativeWind de este plan siguen el setup documentado de la serie 4.x. **Antes de aplicarlos, leer `apps/mobile/node_modules/nativewind/README.md`** (y su carpeta `docs/` si existe): si el setup documentado difiere (p. ej. sin plugin de babel, o Tailwind 4), seguir los docs instalados y anotar la desviación en el commit. Mismo criterio que las reglas de agente de Next.js y Turborepo de este repo: los docs instalados mandan sobre el entrenamiento.

---

## Estructura de ficheros (resultado final)

```
apps/mobile/
├── app/                        # rutas expo-router
│   ├── _layout.tsx             # Stack raíz + import de global.css
│   ├── +not-found.tsx          # 404
│   └── (tabs)/
│       ├── _layout.tsx         # 5 tabs
│       ├── index.tsx           # Directo
│       ├── clasificacion.tsx
│       ├── buscar.tsx
│       ├── favoritos.tsx
│       └── ajustes.tsx
├── src/
│   ├── components/
│   │   └── PlaceholderScreen.tsx
│   └── theme/
│       ├── tokens.ts           # única fuente de los tokens de DESIGN.md
│       └── tokens.test.ts
├── app.json
├── global.css
├── metro.config.js
├── babel.config.js             # si los docs de NativeWind instalado lo piden
├── tailwind.config.ts
├── tsconfig.json
└── package.json                # @sports/mobile
```

Modificados en el repo: `eslint.config.mjs` (ignores + react-hooks para mobile), `docs/superpowers/specs/2026-10-05-app-movil-design.md` (estado). NO se toca: `turbo.json` (las tareas genéricas ya recogen el workspace), `.dockerignore` (ya excluye `apps/mobile`), CI (el audit bloqueante deriva los workspaces del Dockerfile, que no copia mobile).

---

### Task 1: Scaffold del workspace

**Files:**
- Create: `apps/mobile/` (generado por create-expo-app)
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Generar la app (sin instalar, para que npm workspaces enlace)**

Desde la raíz del repo (PowerShell, sin `&&`):

```powershell
npx create-expo-app@latest apps/mobile --template default --no-install
```

Expected: directorio creado con `app/`, `package.json`, `app.json`, `tsconfig.json`, `.gitignore`. El `--template default` trae expo-router con tabs de ejemplo (se sustituyen en Task 4).

- [ ] **Step 2: Registrar la versión instalada**

```powershell
node -p "require('./apps/mobile/package.json').dependencies"
```

Expected: `expo` en `~57.x`. Anótalo en el mensaje del commit final. Si NO fuera 57.x, para y avisa (el resto del plan asume 57).

- [ ] **Step 3: Renombrar paquete y definir scripts**

Editar `apps/mobile/package.json`: `name` → `"@sports/mobile"`, asegurar `"private": true`, y dejar los scripts así (el template trae otros; sustituir el bloque completo):

```json
"scripts": {
  "dev": "expo start",
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "typecheck": "tsc --noEmit",
  "lint": "eslint app src",
  "test": "vitest run"
}
```

(`dev` es alias para que `npm run dev` de turbo incluya la app; `main: "expo-router/entry"` debe seguir presente.)

- [ ] **Step 4: Limpiar boilerplate del template**

Eliminar directorios de ejemplo (los recreamos nosotros con el tema real):

```powershell
Remove-Item -Recurse -Force apps/mobile/components, apps/mobile/hooks, apps/mobile/constants, apps/mobile/scripts
```

Expected: solo quedan `app/`, `assets/`, configs y `.gitignore`. NO borrar `app/+not-found.tsx` aún (se reemplaza en Task 4).

- [ ] **Step 5: Instalar en el workspace raíz**

```powershell
npm install
```

Expected: instala sin errores; el lockfile queda actualizado con las deps de mobile. Verificar resolución de React (raíz tiene react 18 para web, mobile traerá el suyo):

```powershell
npm ls react
```

Expected: una versión en la raíz (18.x para web) y la de mobile (19.x en SDK 57) anidada en `apps/mobile/node_modules/react`. Ambas resolviendo sin `invalid`. Si `npm ls` marca UNMETDED/invalid, parar y diagnosticar antes de seguir.

- [ ] **Step 6: Verificar el .gitignore de la app**

```powershell
Get-Content apps/mobile/.gitignore
```

Expected: incluye `.expo/`, `node_modules/`. Si falta algo, añadirlo.

- [ ] **Step 7: Commit**

```powershell
git add apps/mobile package.json package-lock.json
git commit -m "feat(mobile): scaffold apps/mobile con Expo SDK 57 (expo-router)"
```

---

### Task 2: TypeScript

**Files:**
- Modify: `apps/mobile/tsconfig.json`

- [ ] **Step 1: Escribir el tsconfig**

Sustituir el contenido de `apps/mobile/tsconfig.json` por (extiende la base de Expo, NO la del repo — `tsconfig.base.json` es Node16 para servidor; RN necesita bundler. Los flags estrictos se replican a mano):

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 2: Verificar que tsc pasa sobre el template aún sin tocar**

```powershell
npm run typecheck --workspace=@sports/mobile
```

Expected: PASS (o errores solo del boilerplate que se elimina en Task 4 — si aparecen, anótalos y sigue; se resuelven al reemplazar `app/`).

- [ ] **Step 3: Commit**

```powershell
git add apps/mobile/tsconfig.json
git commit -m "feat(mobile): tsconfig estricto con alias @/*"
```

---

### Task 3: NativeWind + tokens de diseño

**Files:**
- Create: `apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/theme/tokens.test.ts`
- Create: `apps/mobile/tailwind.config.ts`, `apps/mobile/global.css`, `apps/mobile/metro.config.js`
- Create (según docs): `apps/mobile/babel.config.js`
- Modify: `apps/mobile/package.json` (deps), `apps/mobile/app/_layout.tsx` (import global.css — Task 4 lo reescribe)

- [ ] **Step 1: Instalar NativeWind y Tailwind según los docs instalados**

```powershell
npx expo install nativewind
Get-Content apps/mobile/node_modules/nativewind/README.md
```

Leer el README completo. Expected: el README indica la versión de tailwindcss requerida y los pasos de setup (metro, babel, css). Instalar Tailwind en la versión que pida (baseline de la serie 4: `npm install -D tailwindcss@^3.4.0`). Instalar también vitest (runner del repo):

```powershell
npm install -D vitest@^1.6.0 --workspace=@sports/mobile
```

- [ ] **Step 2: Escribir el test de tokens primero (TDD — debe fallar)**

Crear `apps/mobile/src/theme/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { palette, radii } from './tokens';

// Los valores SON el contrato con DESIGN.md (frontmatter del sistema de diseño
// de la web). Si este test falla, alguien ha cambiado un token sin actualizar
// el diseño — o al revés.
describe('tokens de diseño (DESIGN.md)', () => {
  it('paleta de identidad y estado', () => {
    expect(palette.rinkPassion).toBe('#991b1b');
    expect(palette.rinkPassionLight).toBe('#b91c1c');
    expect(palette.rinkPassionDark).toBe('#7f1d1d');
    expect(palette.live).toBe('#10b981');
    expect(palette.halftime).toBe('#f59e0b');
    expect(palette.premiumGold).toBe('#fbbf24');
  });

  it('superficies y texto (claro y oscuro)', () => {
    expect(palette.surfaceBg).toBe('#f8fafc');
    expect(palette.surfaceCard).toBe('#ffffff');
    expect(palette.surfaceBgDark).toBe('#0b1220');
    expect(palette.surfaceCardDark).toBe('#111a2e');
    expect(palette.text).toBe('#0f172a');
    expect(palette.textInverse).toBe('#f8fafc');
    expect(palette.textMuted).toBe('#64748b');
    expect(palette.textMutedDark).toBe('#94a3b8');
    expect(palette.border).toBe('#e2e8f0');
    expect(palette.borderDark).toBe('#1e293b');
  });

  it('acentos funcionales', () => {
    expect(palette.relegation).toBe('#f97316');
    expect(palette.cardBlue).toBe('#3b82f6');
  });

  it('radios en px', () => {
    expect(radii.md).toBe(8);
    expect(radii.lg).toBe(12);
    expect(radii.xl).toBe(16);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```powershell
npm run test --workspace=@sports/mobile
```

Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 4: Implementar tokens.ts (mínimo para pasar)**

Crear `apps/mobile/src/theme/tokens.ts` — los 18 colores y 3 radios del frontmatter de `DESIGN.md`:

```ts
/**
 * Única fuente de los tokens de diseño de la app móvil.
 * Espejo exacto del frontmatter de DESIGN.md (raíz del repo). El test
 * tokens.test.ts es el contrato: si DESIGN.md cambia, este fichero y el test
 * cambian juntos.
 */
export const palette = {
  // Identidad (granate de pista)
  rinkPassion: '#991b1b',
  rinkPassionLight: '#b91c1c',
  rinkPassionDark: '#7f1d1d',
  // Superficies (claro / oscuro "de sofá")
  surfaceBg: '#f8fafc',
  surfaceCard: '#ffffff',
  surfaceBgDark: '#0b1220',
  surfaceCardDark: '#111a2e',
  // Texto y bordes
  text: '#0f172a',
  textInverse: '#f8fafc',
  textMuted: '#64748b',
  textMutedDark: '#94a3b8',
  border: '#e2e8f0',
  borderDark: '#1e293b',
  // Estado en directo (los únicos colores "vivos")
  live: '#10b981',
  halftime: '#f59e0b',
  premiumGold: '#fbbf24',
  // Funcionales de dato
  relegation: '#f97316',
  cardBlue: '#3b82f6',
} as const;

export const radii = {
  md: 8,
  lg: 12,
  xl: 16,
} as const;
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

```powershell
npm run test --workspace=@sports/mobile
```

Expected: PASS (4 tests).

- [ ] **Step 6: Configurar NativeWind (baseline 4.x — ajustar si los docs difieren)**

Crear `apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
```

Crear `apps/mobile/babel.config.js` (SOLO si los docs instalados lo piden; SDK recientes no generan babel.config.js por defecto):

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }]],
    plugins: ['nativewind/babel'],
  };
};
```

Crear `apps/mobile/global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Crear `apps/mobile/tailwind.config.ts` (nombres de clase = nombres de DESIGN.md, en kebab-case; darkMode `media` sigue el ajuste del SO — el toggle manual llega en M5):

```ts
import type { Config } from 'tailwindcss';

import { palette } from './src/theme/tokens';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        'rink-passion': palette.rinkPassion,
        'rink-passion-light': palette.rinkPassionLight,
        'rink-passion-dark': palette.rinkPassionDark,
        'surface-bg': palette.surfaceBg,
        'surface-card': palette.surfaceCard,
        'surface-bg-dark': palette.surfaceBgDark,
        'surface-card-dark': palette.surfaceCardDark,
        text: palette.text,
        'text-inverse': palette.textInverse,
        'text-muted': palette.textMuted,
        'text-muted-dark': palette.textMutedDark,
        border: palette.border,
        'border-dark': palette.borderDark,
        live: palette.live,
        halftime: palette.halftime,
        'premium-gold': palette.premiumGold,
        relegation: palette.relegation,
        'card-blue': palette.cardBlue,
      },
      borderRadius: {
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
} satisfies Config;
```

- [ ] **Step 7: Verificación de tipo y lint del paquete**

```powershell
npm run typecheck --workspace=@sports/mobile
npm run lint --workspace=@sports/mobile
```

Expected: PASS ambos (si lint se queja de algo del template, se resuelve en Task 4/5).

- [ ] **Step 8: Commit**

```powershell
git add apps/mobile
git commit -m "feat(mobile): NativeWind + tokens de DESIGN.md con test de contrato"
```

---

### Task 4: Navegación por tabs + pantallas base

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/+not-found.tsx`
- Create: `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/(tabs)/index.tsx`, `clasificacion.tsx`, `buscar.tsx`, `favoritos.tsx`, `ajustes.tsx`
- Create: `apps/mobile/src/components/PlaceholderScreen.tsx`
- Delete: pantallas de ejemplo del template en `app/`
- Modify: `apps/mobile/app.json` (nombre + scheme)

Sin tests de render (vitest no monta componentes RN; el spec reserva pruebas de componentes "según necesidad"). Verificación: typecheck + smoke manual en Expo Go.

- [ ] **Step 1: Reemplazar app/ del template**

Borrar las pantallas de ejemplo del template (conservar la carpeta):

```powershell
Get-ChildItem apps/mobile/app -Recurse -File | Remove-Item -Force
```

Crear `apps/mobile/app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

import '../global.css';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
```

Crear `apps/mobile/app/+not-found.tsx`:

```tsx
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { palette } from '@/theme/tokens';

export default function NotFoundScreen() {
  const dark = useColorScheme() === 'dark';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: dark ? palette.surfaceBgDark : palette.surfaceBg }]}>
        <Text style={[styles.title, { color: dark ? palette.textInverse : palette.text }]}>
          Pantalla no encontrada
        </Text>
        <Link href="/" style={[styles.link, { color: palette.rinkPassion }]}>
          Volver al inicio
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  link: { fontSize: 15, fontWeight: '600' },
});
```

- [ ] **Step 2: Componente placeholder compartido**

Crear `apps/mobile/src/components/PlaceholderScreen.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from 'react-native';

import { palette } from '@/theme/tokens';

interface PlaceholderScreenProps {
  title: string;
  message: string;
}

/**
 * Pantalla provisional de M1. Las pantallas reales (datos, sesiones, etc.)
 * llegan con M2+; mientras tanto, cada tab renderiza esto.
 */
export function PlaceholderScreen({ title, message }: PlaceholderScreenProps) {
  const dark = useColorScheme() === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: dark ? palette.surfaceBgDark : palette.surfaceBg }]}>
      <Text style={[styles.title, { color: dark ? palette.textInverse : palette.text }]}>{title}</Text>
      <Text style={[styles.message, { color: dark ? palette.textMutedDark : palette.textMuted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  message: { fontSize: 14, textAlign: 'center' },
});
```

- [ ] **Step 3: Layout de tabs con el tema de la web**

Crear `apps/mobile/app/(tabs)/_layout.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { palette } from '@/theme/tokens';

const TAB_ICON = {
  index: ['pulse', 'pulse-outline'],
  clasificacion: ['podium', 'podium-outline'],
  buscar: ['search', 'search-outline'],
  favoritos: ['star', 'star-outline'],
  ajustes: ['settings', 'settings-outline'],
} as const;

export default function TabsLayout() {
  const dark = useColorScheme() === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleAlign: 'left',
        headerStyle: {
          backgroundColor: dark ? palette.surfaceCardDark : palette.surfaceCard,
        },
        headerTintColor: dark ? palette.textInverse : palette.text,
        tabBarActiveTintColor: palette.rinkPassion,
        tabBarInactiveTintColor: dark ? palette.textMutedDark : palette.textMuted,
        tabBarStyle: {
          backgroundColor: dark ? palette.surfaceCardDark : palette.surfaceCard,
          borderTopColor: dark ? palette.borderDark : palette.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Directo',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? TAB_ICON.index[0] : TAB_ICON.index[1]} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="clasificacion"
        options={{
          title: 'Clasificación',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? TAB_ICON.clasificacion[0] : TAB_ICON.clasificacion[1]} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="buscar"
        options={{
          title: 'Buscar',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? TAB_ICON.buscar[0] : TAB_ICON.buscar[1]} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="favoritos"
        options={{
          title: 'Favoritos',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? TAB_ICON.favoritos[0] : TAB_ICON.favoritos[1]} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? TAB_ICON.ajustes[0] : TAB_ICON.ajustes[1]} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

NOTA: si `podium` no existiera en la versión de Ionicons instalada, sustituir por `list` / `list-outline` (compilaría igual; decidir mirando el error de tipos).

- [ ] **Step 4: Las 5 pantallas**

`apps/mobile/app/(tabs)/index.tsx`:

```tsx
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function DirectoScreen() {
  return (
    <PlaceholderScreen
      title="Directo"
      message="Los partidos de hoy llegan con el hito M2 (REST + SSE)."
    />
  );
}
```

`apps/mobile/app/(tabs)/clasificacion.tsx`:

```tsx
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function ClasificacionScreen() {
  return (
    <PlaceholderScreen
      title="Clasificación"
      message="Las tablas por competición llegan con el hito M2."
    />
  );
}
```

`apps/mobile/app/(tabs)/buscar.tsx`:

```tsx
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function BuscarScreen() {
  return (
    <PlaceholderScreen
      title="Buscar"
      message="Equipos, jugadores y competiciones llegan con el hito M2."
    />
  );
}
```

`apps/mobile/app/(tabs)/favoritos.tsx`:

```tsx
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function FavoritosScreen() {
  return (
    <PlaceholderScreen
      title="Favoritos"
      message="Requiere sesión (hito M3, login con Google)."
    />
  );
}
```

`apps/mobile/app/(tabs)/ajustes.tsx`:

```tsx
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function AjustesScreen() {
  return (
    <PlaceholderScreen
      title="Ajustes"
      message="Notificaciones, idioma y sesión llegan con los hitos M3-M5."
    />
  );
}
```

- [ ] **Step 5: app.json — identidad y scheme futuro**

Editar `apps/mobile/app.json`: dentro de `expo`, fijar `"name": "Stick Live"`, `"slug": "sticklive"` y añadir `"scheme": "sticklive"` (lo pide el §5 del spec para el OAuth por deep link de M3; una línea ahora evita tocar config después). Dejar icon/splash del template — los assets de store se deciden en M5.

- [ ] **Step 6: Verificar tipo + lint**

```powershell
npm run typecheck --workspace=@sports/mobile
npm run lint --workspace=@sports/mobile
```

Expected: PASS ambos.

- [ ] **Step 7: Commit**

```powershell
git add apps/mobile
git commit -m "feat(mobile): 5 tabs navegables con tema claro/oscuro de la web"
```

---

### Task 5: ESLint del monorepo + cableado CI

**Files:**
- Modify: `eslint.config.mjs` (raíz)

- [ ] **Step 1: Ampliar ignores y react-hooks a mobile**

En `eslint.config.mjs`:

(a) Añadir al primer bloque `ignores` (después de `'**/.turbo/**'`):

```js
      '**/.expo/**',
```

(b) El bloque "Reglas específicas del frontend" queda partido en dos — react-hooks cubre web Y mobile; las reglas de Next se quedan SOLO en web. Sustituir el bloque completo por:

```js
  // Reglas de React Hooks: web y app móvil (ambas son React).
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Reglas específicas de Next.js: solo apps/web.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      '@next/next/no-img-element': 'warn',
    },
  },
```

- [ ] **Step 2: Verificar lint del monorepo completo**

```powershell
npm run lint
```

Expected: PASS en todos los workspaces incluido mobile.

- [ ] **Step 3: Confirmar que el audit bloqueante no cambia**

```powershell
Select-String -Path deploy/Dockerfile -Pattern '^COPY '
```

Expected: la lista de COPY no incluye `apps/mobile` (el audit de CI deriva los workspaces de esas líneas). `.dockerignore` ya excluye la app — no tocar nada. Nota: el audit informativo (`moderate`, no bloqueante) empezará a listar deps de Expo — comportamiento esperado, no arreglar en este plan.

- [ ] **Step 4: Commit**

```powershell
git add eslint.config.mjs
git commit -m "chore(lint): react-hooks también para apps/mobile; ignores de .expo"
```

---

### Task 6: Verificación completa + estado

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-app-movil-design.md` (línea de estado)

- [ ] **Step 1: Gates completos del repo**

```powershell
npm run typecheck
npm run lint
npm run test
```

Expected: los tres PASS con `@sports/mobile` incluido en la salida de turbo.

- [ ] **Step 2: Doctor de Expo**

```powershell
npx expo-doctor --cwd apps/mobile
```

Expected: sin errores (avisos menores se documentan en el commit, no se arreglan aquí).

- [ ] **Step 3: Smoke manual en Expo Go**

```powershell
npm run dev --workspace=@sports/mobile
```

Abrir con Expo Go (dispositivo Android o emulador). Verificar:
1. Las 5 tabs navegan y el icono activo queda granate.
2. Cada pantalla muestra su placeholder con fondo correcto.
3. Cambiar el tema del SO (claro/oscuro) alterna el tema de la app (estrategia `media`).
4. Una ruta inexistente (p. ej. abrir `sticklive://noexiste`) muestra la pantalla de no-encontrado.

Si no hay dispositivo/emulador disponible, dejar constancia en el resultado de la tarea: la verificación visual queda PENDIENTE para el usuario y NO se marca M1 como verificado en el spec.

- [ ] **Step 4: Actualizar el estado del spec**

En `docs/superpowers/specs/2026-10-05-app-movil-design.md`, línea 4, sustituir:

```markdown
Estado: Diseño aprobado en brainstorming; pendiente plan de implementación.
```

por:

```markdown
Estado: En implementación por hitos. M1 (esqueleto) completado y verificado.
```

(El paso anterior — smoke manual — debe estar hecho o asumido explícitamente por el usuario antes de escribir "verificado".)

- [ ] **Step 5: Commit final**

```powershell
git add docs/superpowers/specs/2026-10-05-app-movil-design.md
git commit -m "docs: M1 de la app móvil completado"
```

---

## Riesgos conocidos

1. **NativeWind 5.0.0 es más nuevo que la mayoría de guías** (escritas para 4.x). El Step 1 de Task 3 obliga a leer el README instalado antes de configurar. Si el setup difiere (Tailwind 4, sin babel plugin, CSS-first config), mandan los docs instalados y se anota la desviación.
2. **Duplicidad de React (raíz 18 para web, 19 en mobile).** Esperado con npm workspaces; `npm ls react` debe mostrar ambos anidados correctamente. Metro resuelve desde `apps/mobile/`.
3. **Audit informativo de CI** crecerá con deps de Expo — es el paso no bloqueante, ya previsto en el comentario del workflow.
4. **Icono/splash genéricos del template** hasta M5 (assets de store), decisión del spec — no es un olvido.
