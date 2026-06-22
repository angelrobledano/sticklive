'use client';

// Página temporal SOLO para verificar Sentry. BORRAR tras comprobar que el
// error aparece en Issues: elimina la carpeta apps/web/src/app/[locale]/sentry-test
import * as Sentry from '@sentry/nextjs';

export default function SentryTestPage() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1>Sentry test (borrar)</h1>
      <button
        type="button"
        onClick={() => {
          // 1) error capturado explícitamente
          Sentry.captureException(new Error('Sentry test (client) — borrar'));
          // 2) error no capturado (función inexistente) para probar el global handler
          // @ts-expect-error función inexistente a propósito
          myUndefinedFunction();
        }}
        style={{ padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}
      >
        Lanzar error de prueba Sentry
      </button>
    </div>
  );
}
