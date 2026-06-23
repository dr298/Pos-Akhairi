'use client';

// apps/web/src/app/error.tsx
//
// Sprint 25 — root-segment error boundary. Catches anything thrown
// below the root layout (e.g. inside /pos/*, /kiosk, /login pages)
// and shows the actual error message + a useful recovery path.
// Without this, Next.js would render the global-error.tsx fallback
// (which is the "everything broke" page, not a per-route error).
//
// IMPORTANT: error.tsx is a Client Component (the 'use client' at
// the top is required). It cannot read cookies/headers etc.
// Server-side error data is in `error.digest` if you want to log.

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app-error]', error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 shadow-sm">
        <div className="text-3xl mb-3">⚠️</div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Terjadi kesalahan
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Halaman tidak dapat dimuat. Coba muat ulang, atau kembali ke POS.
        </p>
        <pre
          className="mt-4 text-xs font-mono bg-neutral-100 dark:bg-neutral-950 text-red-700 dark:text-red-300 border border-neutral-200 dark:border-neutral-800 rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap break-words"
        >
          {error?.message || 'Unknown error'}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Coba lagi
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/pos';
              }
            }}
            className="px-3 py-1.5 text-sm rounded-md bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-700"
          >
            Kembali ke POS
          </button>
        </div>
      </div>
    </main>
  );
}
