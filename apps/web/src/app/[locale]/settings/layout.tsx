import type { Metadata } from 'next';
import { privateMetadata } from '@/lib/seo';

/**
 * Metadata de la zona privada (cubre también /settings/notifications/[kind]).
 * Las páginas son componentes de cliente y no pueden exportarla: ver
 * `privateMetadata`.
 */
export const metadata: Metadata = privateMetadata();

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
