import type { Metadata } from 'next';
import { privateMetadata } from '@/lib/seo';

/**
 * Metadata de la zona privada (cubre /premium/success y /premium/error, ambas
 * ya excluidas en robots.txt). Las páginas son componentes de cliente y no
 * pueden exportarla: ver `privateMetadata`.
 */
export const metadata: Metadata = privateMetadata();

export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
