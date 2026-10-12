import type { Metadata } from 'next';
import { privateMetadata } from '@/lib/seo';

/**
 * Metadata de la zona privada. La página es un componente de cliente y no
 * puede exportarla: ver `privateMetadata`.
 */
export const metadata: Metadata = privateMetadata();

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
