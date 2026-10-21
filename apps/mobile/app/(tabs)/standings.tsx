import { Redirect } from 'expo-router';

/**
 * Redirección de compatibilidad: la pestaña de clasificación ahora es
 * Competiciones (paridad con web sticklive.eu/competitions).
 */
export default function StandingsRedirect() {
  return <Redirect href="/(tabs)/competitions" />;
}
