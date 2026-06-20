import { register } from './registry.js';
import { cashProvider } from './cash.js';

let initialized = false;

export function initPaymentProviders(): void {
  if (initialized) return;
  register(cashProvider);
  // Midtrans and Xendit will be added in Sprint 2
  initialized = true;
}

initPaymentProviders();

export * from './types.js';
export * from './registry.js';
export { cashProvider } from './cash.js';
