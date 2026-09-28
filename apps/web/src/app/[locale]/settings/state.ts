/**
 * #344: decide qué mostrar en "Mis equipos" (Ajustes). Un fallo de API tiene
 * prioridad sobre el estado vacío: si el fetch falla, un usuario que SÍ sigue
 * equipos no debe ver el copy de onboarding ("elige tus favoritos"), creería que
 * no tiene ninguno. Función pura para fijar la precedencia.
 *
 * Vive FUERA de `page.tsx`: Next solo permite exports de ruta en una página.
 */
export type MyTeamsState = 'loading' | 'error' | 'empty' | 'list';

export function myTeamsState(input: { loading: boolean; hasError: boolean; count: number }): MyTeamsState {
  if (input.loading) return 'loading';
  if (input.hasError) return 'error';
  return input.count > 0 ? 'list' : 'empty';
}
