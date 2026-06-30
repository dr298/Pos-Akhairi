import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const tones: Record<Tone, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  muted: 'bg-secondary-text/10 text-secondary-text',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
