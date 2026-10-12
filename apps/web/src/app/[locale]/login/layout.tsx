import type { Metadata } from 'next';
import { privateMetadata } from '@/lib/seo';

/**
 * Metadata de la zona privada. La página es un componente de cliente y no
 * puede exportarla: ver `privateMetadata` (descarta el canonical de la portada
 * que el layout `[locale]` hereda a todas las páginas).
 */
export const metadata: Metadata = privateMetadata();

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
