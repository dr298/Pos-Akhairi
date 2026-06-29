import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg bg-[var(--neo-bg)] px-3 py-2 text-sm',
        'text-[var(--foreground)] placeholder:text-neo-muted',
        'shadow-[inset_3px_3px_6px_var(--neo-shadow-dark),inset_-3px_-3px_6px_var(--neo-shadow-light)]',
        'focus:outline-none focus:shadow-[inset_4px_4px_8px_var(--neo-shadow-dark),inset_-4px_-4px_8px_var(--neo-shadow-light),0_0_0_2px_rgba(220,38,38,0.4)]',
        'disabled:opacity-50',
        'transition-shadow duration-200',
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
        'flex min-h-[64px] w-full rounded-lg bg-[var(--neo-bg)] px-3 py-2 text-sm',
        'text-[var(--foreground)] placeholder:text-neo-muted',
        'shadow-[inset_3px_3px_6px_var(--neo-shadow-dark),inset_-3px_-3px_6px_var(--neo-shadow-light)]',
        'focus:outline-none focus:shadow-[inset_4px_4px_8px_var(--neo-shadow-dark),inset_-4px_-4px_8px_var(--neo-shadow-light),0_0_0_2px_rgba(220,38,38,0.4)]',
        'disabled:opacity-50 resize-none',
        'transition-shadow duration-200',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
