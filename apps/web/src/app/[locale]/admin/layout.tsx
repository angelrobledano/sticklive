import type { Metadata } from 'next';
import { privateMetadata } from '@/lib/seo';
import { AdminNav } from '@/components/admin/AdminNav';

/**
 * Metadata de la zona privada (cubre también /admin/resolucion, /admin/clubes y /admin/jugadores). Las páginas
 * son componentes de cliente y no pueden exportarla: ver `privateMetadata`.
 */
export const metadata: Metadata = privateMetadata();

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
