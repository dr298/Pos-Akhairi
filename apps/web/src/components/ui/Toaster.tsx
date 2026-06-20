'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-center"
      richColors
      toastOptions={{
        className: 'text-sm',
      }}
    />
  );
}
