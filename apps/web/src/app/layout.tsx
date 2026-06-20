import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'pos.akhairi.com — Bakmie POS',
  description: 'Bakmie Kota Juang POS system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
