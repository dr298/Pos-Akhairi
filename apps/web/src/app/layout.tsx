import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/hooks/useAuth';
import { Toaster } from '@/components/ui/Toaster';

export const metadata: Metadata = {
  title: 'pos.akhairi.com — Bakmie POS',
  description: 'Bakmie Kota Juang POS system',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body className="bg-neutral-950 text-neutral-100 antialiased">
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
