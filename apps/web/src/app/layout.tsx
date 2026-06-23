import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/hooks/useAuth';
import { Toaster } from '@/components/ui/Toaster';
import { ThemeProvider, NO_FLASH_SCRIPT } from '@/hooks/useTheme';

// Sprint 24 — page <title> now reads the business name from the
// settings table (BUSINESS_NAME, same source the receipt uses).
// Previously hardcoded as 'pos.akhairi.com — Bakmie POS' which
// leaked the internal domain to the browser tab and bookmarks.
//
// SSR: generateMetadata runs on the server per request. It hits
// the public endpoint at /api/business/public-name (added in
// Sprint 24, no auth required, only exposes `name`). The
// /api/* rewrite sends it to the api container same-origin.
// Cache: revalidate every 60s so a settings change in /pos/settings
// shows up in the title without a full redeploy.
export async function generateMetadata(): Promise<Metadata> {
  const fallbackName = 'Bakmie POS';
  try {
    // Use the rewrite path so the web's own server hits itself
    // and the /api/* rewrite forwards to the api container.
    // We use 127.0.0.1 (not localhost) to avoid IPv6 resolution
    // edge cases on hosts where localhost resolves to ::1 first.
    const port = process.env.PORT || '3000';
    const path = '/api/business/public-name';
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { name?: string };
    return {
      title: data.name || fallbackName,
      description: 'POS system',
    };
  } catch (err) {
    // Don't blow up the page if the API is down — fall back to
    // a sensible default. The cache will retry on next request.
    console.error('[metadata] business name fetch failed:', err);
    return {
      title: fallbackName,
      description: 'POS system',
    };
  }
}

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* No-flash theme bootstrap: runs before React hydrates so the user
            never sees a wrong-theme flash on reload. Reads localStorage
            'pos:theme' or falls back to prefers-color-scheme. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
