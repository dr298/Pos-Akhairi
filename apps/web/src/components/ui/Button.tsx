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
  // Neomorphic primary — raised accent
  primary: [
    'bg-red-600 text-white dark:text-white',
    'shadow-[4px_4px_8px_var(--neo-shadow-dark),-4px_-4px_8px_var(--neo-shadow-light)]',
    'hover:bg-red-500 hover:shadow-[6px_6px_12px_var(--neo-shadow-dark),-6px_-6px_12px_var(--neo-shadow-light)]',
    'active:bg-red-700 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.3),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]',
    'disabled:bg-red-900 disabled:shadow-none disabled:opacity-50',
  ].join(' '),
  // Neomorphic secondary — raised neutral
  secondary: [
    'bg-[var(--neo-bg)] text-[var(--foreground)]',
    'shadow-[4px_4px_8px_var(--neo-shadow-dark),-4px_-4px_8px_var(--neo-shadow-light)]',
    'hover:shadow-[6px_6px_12px_var(--neo-shadow-dark),-6px_-6px_12px_var(--neo-shadow-light)]',
    'active:shadow-[inset_3px_3px_6px_var(--neo-shadow-dark),inset_-3px_-3px_6px_var(--neo-shadow-light)]',
    'disabled:opacity-50 disabled:shadow-none',
  ].join(' '),
  // Ghost — no shadow, just bg tint on hover
  ghost: [
    'bg-transparent text-[var(--foreground)]',
    'hover:bg-black/5 dark:hover:bg-white/5',
    'active:bg-black/10 dark:active:bg-white/10',
    'disabled:opacity-50',
  ].join(' '),
  // Danger — raised red
  danger: [
    'bg-red-700 text-white',
    'shadow-[4px_4px_8px_var(--neo-shadow-dark),-4px_-4px_8px_var(--neo-shadow-light)]',
    'hover:bg-red-600',
    'active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.3),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]',
    'disabled:opacity-50 disabled:shadow-none',
  ].join(' '),
  // Outline — neomorphic inset-like
  outline: [
    'bg-[var(--neo-bg)] text-[var(--foreground)]',
    'shadow-[inset_2px_2px_4px_var(--neo-shadow-dark),inset_-2px_-2px_4px_var(--neo-shadow-light)]',
    'hover:shadow-[inset_3px_3px_6px_var(--neo-shadow-dark),inset_-3px_-3px_6px_var(--neo-shadow-light)]',
    'active:shadow-[inset_4px_4px_8px_var(--neo-shadow-dark),inset_-4px_-4px_8px_var(--neo-shadow-light)]',
    'disabled:opacity-50',
  ].join(' '),
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-5 text-base rounded-xl',
  xl: 'h-14 px-6 text-lg rounded-xl',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', asChild, children, ...props }, ref) => {
    const classes = cn(
      'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 select-none',
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
