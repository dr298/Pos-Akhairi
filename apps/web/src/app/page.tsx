import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="mb-12">
        <h1 className="text-4xl font-bold mb-2">🍜 pos.akhairi.com</h1>
        <p className="text-neutral-400">Bakmie Kota Juang — POS (Sprint 0 scaffold)</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-400 mb-3">Stack status</p>
            <code className="text-xs text-neutral-300 block bg-neutral-900 p-2 rounded">
              GET /api/health → 200
            </code>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-400 mb-3">Owner / Manager / Cashier</p>
            <Button asChild>
              <Link href="/login">Open login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-12 text-xs text-neutral-500">
        <p>Sprint 0 — monorepo scaffold. Pilot: BKJ Pasar Lama, Tangerang.</p>
      </footer>
    </main>
  );
}
