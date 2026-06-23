'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { POSLayout } from '@/components/Layout/POSLayout';
import { CartProvider } from '@/hooks/useCart';
import { PrinterProvider } from '@/contexts/PrinterContext';

/**
 * Sprint 25.4 — class-based ErrorBoundary that captures
 * `errorInfo.componentStack` (the component tree at the time of the
 * crash) and POSTs it to /api/errors/client-error. The Next.js
 * `error.tsx` boundary only sees `error.message` + `error.digest`,
 * not the component stack. For React errors like #310 ("Rendered
 * fewer hooks than expected") the component stack is the only way
 * to know WHICH component has the bad hook order.
 *
 * This wraps the /pos/* tree (CartProvider → PrinterProvider →
 * POSLayout → children). If the boundary fires, we get the
 * component stack AT THE /pos LEVEL. If a deeper component throws
 * (e.g. MenuGrid), its name will be in the stack.
 *
 * The fallback uses an inline error UI so the user can still see
 * "Kembali ke POS" without bouncing up to the root error.tsx.
 */
class PosTreeErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string | null }
> {
  state = { error: null as Error | null, componentStack: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[pos-tree-error]', error, info);
    // Fire-and-forget report. Don't block the error UI on the network.
    try {
      void fetch('/api/errors/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: error?.message,
          stack: error?.stack,
          digest: (error as Error & { digest?: string })?.digest,
          source: 'pos-tree-error-boundary',
          route: typeof window !== 'undefined' ? window.location.pathname : undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          // The KEY field for debugging React #310:
          componentStack: info?.componentStack ?? null,
        }),
      });
    } catch {
      // ignore
    }
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
          <div className="w-full max-w-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 shadow-sm">
            <div className="text-3xl mb-3">⚠️</div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Terjadi kesalahan (di dalam /pos)
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              {this.state.error.message}
            </p>
            {this.state.componentStack && (
              <pre className="mt-3 text-[10px] font-mono bg-neutral-100 dark:bg-neutral-950 text-red-700 dark:text-red-300 border border-neutral-200 dark:border-neutral-800 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap break-words">
                {this.state.componentStack}
              </pre>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  this.setState({ error: null, componentStack: null });
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                Coba lagi
              </button>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.href = '/pos';
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-700"
              >
                Muat ulang
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function PosLayoutPage({ children }: { children: React.ReactNode }) {
  return (
    <PosTreeErrorBoundary>
      <CartProvider>
        <PrinterProvider>
          <POSLayout>{children}</POSLayout>
        </PrinterProvider>
      </CartProvider>
    </PosTreeErrorBoundary>
  );
}
