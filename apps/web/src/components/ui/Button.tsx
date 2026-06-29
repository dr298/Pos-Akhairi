import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover shadow-sm',
  secondary: 'bg-card text-foreground border border-border hover:bg-card-hover shadow-sm',
  ghost: 'bg-transparent text-muted-foreground hover:bg-muted',
  danger: 'bg-danger text-white hover:bg-danger/90',
  outline: 'bg-transparent border border-border text-foreground hover:bg-muted',
};

const sizes: Record<Size, string> = {
  sm: 'text-sm px-3 py-1.5 rounded-lg',
  md: 'text-sm px-4 py-2 rounded-lg',
  lg: 'text-base px-6 py-2.5 rounded-lg',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, asChild, disabled, children, ...props }, ref) => {
    const classes = cn(
      'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 select-none',
      'active:scale-[0.98]',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
      'disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100',
      loading && 'opacity-60 cursor-not-allowed',
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
      <button ref={ref} className={classes} disabled={disabled || loading} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
