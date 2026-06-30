'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const value = controlled ?? internal;
  const setValue = (v: string) => {
    if (controlled === undefined) setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 p-1 rounded-lg bg-muted',
        'overflow-x-auto whitespace-nowrap',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('TabsTrigger must be inside <Tabs>');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={cn(
        'h-9 px-4 text-sm rounded-lg transition-all duration-200',
        active
          ? [
              'bg-card text-foreground font-medium shadow-sm',
            ].join(' ')
          : [
              'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            ].join(' '),
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('TabsContent must be inside <Tabs>');
  if (ctx.value !== value) return null;
  return <div className={cn('pt-4', className)}>{children}</div>;
}
