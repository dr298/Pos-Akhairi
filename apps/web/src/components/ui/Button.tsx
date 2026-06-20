import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-900 disabled:opacity-60',
  secondary:
    'bg-neutral-800 text-neutral-100 hover:bg-neutral-700 active:bg-neutral-600 disabled:opacity-60',
  ghost:
    'bg-transparent text-neutral-200 hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-60',
  danger:
    'bg-red-700 text-white hover:bg-red-800 active:bg-red-900 disabled:opacity-60',
  outline:
    'bg-transparent text-neutral-100 border border-neutral-700 hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-60',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded-md',
  md: 'h-10 px-4 text-sm rounded-md',
  lg: 'h-12 px-5 text-base rounded-lg',
  xl: 'h-14 px-6 text-lg rounded-lg',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', asChild, children, ...props }, ref) => {
    const classes = cn(
      'inline-flex items-center justify-center gap-2 font-medium transition-colors select-none',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60',
      'disabled:cursor-not-allowed',
      variants[variant],
      sizes[size],
      className,
    );
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string }>;
      return React.cloneElement(child, {
        className: cn(classes, child.props.className),
        ...(props as Record<string, unknown>),
      });
    }
    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
