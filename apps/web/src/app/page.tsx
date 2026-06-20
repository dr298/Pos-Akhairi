'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function HomePage() {
  const router = useRouter();
  const { loading, user } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/pos' : '/login');
  }, [loading, user, router]);

  return (
    <main className="min-h-screen flex items-center justify-center text-neutral-400 text-sm">
      Memuat…
    </main>
  );
}
