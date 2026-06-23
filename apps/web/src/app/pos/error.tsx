'use client';

export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 32, color: '#fff', background: '#0a0a0a', minHeight: '100vh' }}>
      <h1>Error in /pos/*</h1>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {error.message}
        {'\n\nDigest: '}
        {error.digest || '(none)'}
        {'\n\nStack:\n'}
        {error.stack || '(no stack)'}
      </pre>
      <button onClick={reset} style={{ marginTop: 16, padding: '8px 16px', background: '#dc2626', color: 'white', border: 0, borderRadius: 6 }}>
        Coba lagi
      </button>
    </div>
  );
}
