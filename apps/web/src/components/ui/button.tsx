import * as React from 'react';
import { cn } from '@/lib/utils';

export function Button({ className, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Comp: any = asChild ? 'a' : 'button';
  return (
    <Comp
      className={cn(
        'inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition',
        className,
      )}
      {...props}
    />
  );
}
