import * as React from 'react';
import { cn } from '@/lib/utils';

interface DialogContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
}
const DialogContext = React.createContext<DialogContextValue | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <DialogContext.Provider value={{ open, setOpen: onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error('DialogContent must be inside <Dialog>');
  if (!ctx.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => ctx.setOpen(false)}
      />
      <div
        className={cn(
          'relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl',
          'bg-card text-foreground',
          'shadow-lg border border-border',
          'max-h-[90vh] overflow-y-auto',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('p-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between', className)}
      {...props}
    />
  );
}
export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 space-y-4', className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'p-4 border-t border-black/5 dark:border-white/5 flex items-center justify-end gap-2',
        className,
      )}
      {...props}
    />
  );
}
export function DialogClose({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(DialogContext);
  return (
    <button
      type="button"
      onClick={() => ctx?.setOpen(false)}
      className={cn(
        'h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground',
        'hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children ?? '✕'}
    </button>
  );
}
