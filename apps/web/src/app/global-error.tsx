'use client';

// apps/web/src/app/global-error.tsx
//
// Sprint 25 — show the actual error message + digest, and a real
// "Back to login" action. Before: only generic "Terjadi kesalahan"
// + "Halaman tidak dapat dimuat" + "Coba lagi" (reset()). Users had
// no way to know what blew up, and "Coba lagi" re-throws the same
// error in a loop.
//
// rootErrorPath matters: global-error.tsx fires when an error
// escapes the root layout itself (e.g. error in a provider or
// a hard layout crash). For errors inside /pos/* the /pos/error.tsx
// boundary catches them first and gives a more context-specific UI.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sprint 25 — surface to console so dev / ops can see the
    // actual stack trace. The Next.js error.digest (if present)
    // is the canonical handle for server-side correlation.
    // eslint-disable-next-line no-console
    console.error('[global-error]', error);

    // Send to /api/errors/client-error so we have a persistent
    // record. Fire-and-forget: failure to report should not block
    // the error UI from rendering. The endpoint is public (no
    // auth) and tolerant of malformed input.
    try {
      void fetch('/api/errors/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: error?.message,
          stack: error?.stack,
          digest: error?.digest,
          source: 'global-error.tsx',
          route: typeof window !== 'undefined' ? window.location.pathname : undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
    } catch {
      // ignore — best effort
    }
  }, [error]);

  const message = error?.message || 'Unknown error';
  const stackHead = (error?.stack || '').split('\n').slice(0, 4).join('\n');

  return (
    <html lang="id">
      <body
        style={{
          background: '#0a0a0a',
          color: '#ededed',
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: 520, textAlign: 'left' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🍜</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Terjadi kesalahan
          </h1>
          <p style={{ color: '#a3a3a3', marginBottom: '1.5rem' }}>
            Halaman tidak dapat dimuat. Coba login ulang, atau salin pesan
            di bawah untuk dilaporkan ke admin.
          </p>
          <pre
            data-testid="global-error-message"
            style={{
              background: '#171717',
              border: '1px solid #262626',
              borderRadius: 6,
              padding: '0.75rem 1rem',
              fontSize: '0.75rem',
              color: '#fca5a5',
              overflow: 'auto',
              maxHeight: 200,
              marginBottom: '1.5rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {message}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
            {stackHead ? `\n\n${stackHead}` : ''}
          </pre>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: '#dc2626',
                color: 'white',
                border: 0,
                borderRadius: 6,
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Coba lagi
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  try {
                    window.localStorage.removeItem('pos:authed');
                  } catch {
                    // ignore
                  }
                  window.location.href = '/login';
                }
              }}
              style={{
                background: '#262626',
                color: 'white',
                border: 0,
                borderRadius: 6,
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Login ulang
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
