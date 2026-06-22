import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/hooks/useAuth';
import { Toaster } from '@/components/ui/Toaster';
import { ThemeProvider, NO_FLASH_SCRIPT } from '@/hooks/useTheme';

export const metadata: Metadata = {
  title: 'pos.akhairi.com — Bakmie POS',
  description: 'Bakmie Kota Juang POS system',
};

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
