import { register } from './registry.js';
import { cashProvider } from './cash.js';
import { midtransProvider } from './midtrans.js';
import { xenditProvider } from './xendit.js';

let initialized = false;

export function initPaymentProviders(): void {
  if (initialized) return;
  register(cashProvider);
  // Sprint 2 — Midtrans Snap & Xendit Invoice providers.
  // Production requires real keys in .env; with dummy keys the upstream
  // API calls will return 401 but the code paths are complete.
  register(midtransProvider);
  register(xenditProvider);
  initialized = true;
}

initPaymentProviders();

export * from './types.js';
export * from './registry.js';
export { cashProvider } from './cash.js';
export { midtransProvider, midtransClientKey, midtransSignature } from './midtrans.js';
export { xenditProvider, verifyXenditWebhook } from './xendit.js';
