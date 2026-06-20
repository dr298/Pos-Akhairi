import type { PaymentProvider } from './types.js';

const providers = new Map<string, PaymentProvider>();

export function register(provider: PaymentProvider): void {
  providers.set(provider.name, provider);
}

export function get(name: string): PaymentProvider | undefined {
  return providers.get(name);
}

export function list(): PaymentProvider[] {
  return Array.from(providers.values());
}

export function names(): string[] {
  return Array.from(providers.keys());
}

export function reset(): void {
  providers.clear();
}
