import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'border-border focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'transition-colors duration-200',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[64px] w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'border-border focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed resize-none',
        'transition-colors duration-200',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
