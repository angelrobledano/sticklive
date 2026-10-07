/**
 * ¿Navegó el usuario más allá de la superficie inicial? (Plan D Task 4, App
 * Open: la doc instalada del SDK pide NO mostrar el ad si la app ya envió al
 * usuario al contenido — "Cold starts and loading screens").
 *
 * PURA y testeada. Compara el estado ACTUAL del root container contra el
 * estado INICIAL capturado en el arranque, nivel a nivel:
 *   · index avanzado respecto al inicial (push en un stack, cambio de pestaña).
 *   · ruta activa distinta (con mismos index/length).
 *   · número de rutas distinto al inicial.
 *
 * Los TABS NO engañan: TabRouter.getInitialState PRE-POBLA su estado con TODAS
 * las rutas desde el arranque (expo-router v7), así que 5 routes con index 0
 * ES el estado inicial, no navegación — de ahí la comparación RELATIVA contra
 * el initial capturado y no absoluta (`routes.length > 1` daba siempre true:
 * bug del review que dejaba el app open inalcanzable).
 *
 * Fail-closed: cualquier shape no reconocible (o asimétrico entre ambos
 * lados) ⇒ true — ante la duda NO se muestra el app open.
 */

interface NavStateLike {
  index?: unknown;
  routes?: unknown;
}

function isStateLike(value: unknown): value is NavStateLike & { routes: unknown[] } {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as NavStateLike).routes)
  );
}

function indexOf(state: NavStateLike): number | null {
  const index = state.index;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null;
}

/** Nombre de la ruta (fallback a key) o null si el shape no lo trae. */
function routeNameOf(route: unknown): string | null {
  if (typeof route !== 'object' || route === null) return null;
  const name = (route as { name?: unknown }).name;
  if (typeof name === 'string' && name.length > 0) return name;
  const key = (route as { key?: unknown }).key;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function stateOf(route: unknown): unknown {
  if (typeof route !== 'object' || route === null) return undefined;
  return (route as { state?: unknown }).state;
}

function navigatedFrom(state: unknown, initial: unknown): boolean {
  // Sin estado anidado en AMBOS lados: fondo idéntico, no hay navegación.
  if ((state === undefined || state === null) && (initial === undefined || initial === null)) {
    return false;
  }
  // Shape no reconocible en cualquiera de los lados: no se puede asegurar que
  // siga en la superficie inicial → conservador.
  if (!isStateLike(state) || !isStateLike(initial)) return true;

  const index = indexOf(state);
  const initialIndex = indexOf(initial);
  if (index === null || initialIndex === null) return true;

  // Avance real: push en un stack o cambio de pestaña.
  if (index > initialIndex) return true;

  const active = state.routes[index] ?? null;
  const initialActive = initial.routes[initialIndex] ?? null;
  const activeName = routeNameOf(active);
  const initialName = routeNameOf(initialActive);
  if (activeName === null || initialName === null) return true; // no determinable
  if (activeName !== initialName) return true;

  // Distinto número de rutas con la misma activa: navegó y volvió por otra vía.
  if (state.routes.length !== initial.routes.length) return true;

  // Misma ruta activa: la diferencia, si la hay, está anidada en ella.
  return navigatedFrom(stateOf(active), stateOf(initialActive));
}

/**
 * true si el usuario ya NO está en la superficie inicial que dio `initial`
 * (el estado del root container capturado al arrancar). `initial` indefinido
 * en ambos lados ⇒ false (nada que comparar); shapes dudosos ⇒ true.
 */
export function hasNavigatedBeyondInitial(state: unknown, initial: unknown): boolean {
  return navigatedFrom(state, initial);
}
