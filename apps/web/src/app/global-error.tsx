'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Terjadi kesalahan
          </h1>
          <p style={{ color: '#a3a3a3', marginBottom: '1.5rem' }}>
            Halaman tidak dapat dimuat.
          </p>
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
        </div>
      </body>
    </html>
  );
}
