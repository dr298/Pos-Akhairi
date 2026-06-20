import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: '#0a0a0a',
        color: '#ededed',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🍜</div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Halaman tidak ditemukan</h1>
        <p style={{ color: '#a3a3a3', marginBottom: '1.5rem' }}>
          Halaman yang Anda cari tidak ada.
        </p>
        <Link
          href="/pos"
          style={{
            display: 'inline-block',
            background: '#dc2626',
            color: 'white',
            borderRadius: 6,
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            textDecoration: 'none',
          }}
        >
          Kembali ke POS
        </Link>
      </div>
    </main>
  );
}
