import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const tones: Record<Tone, string> = {
  default: 'bg-[var(--neo-bg)] text-[var(--foreground)] shadow-[2px_2px_4px_var(--neo-shadow-dark),-2px_-2px_4px_var(--neo-shadow-light)]',
  success: 'bg-emerald-900/40 text-emerald-200 shadow-[2px_2px_4px_var(--neo-shadow-dark),-2px_-2px_4px_var(--neo-shadow-light)]',
  warning: 'bg-amber-900/40 text-amber-200 shadow-[2px_2px_4px_var(--neo-shadow-dark),-2px_-2px_4px_var(--neo-shadow-light)]',
  danger: 'bg-red-900/40 text-red-200 shadow-[2px_2px_4px_var(--neo-shadow-dark),-2px_-2px_4px_var(--neo-shadow-light)]',
  info: 'bg-sky-900/40 text-sky-200 shadow-[2px_2px_4px_var(--neo-shadow-dark),-2px_-2px_4px_var(--neo-shadow-light)]',
  muted: 'bg-[var(--neo-bg)] text-neo-muted shadow-[inset_2px_2px_4px_var(--neo-shadow-dark),inset_-2px_-2px_4px_var(--neo-shadow-light)]',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
