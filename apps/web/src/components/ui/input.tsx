import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-red-500',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
