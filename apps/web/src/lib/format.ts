// Money is stored in cents (integer). Display as Indonesian Rupiah.
export function formatIDR(cents: number): string {
  const rupiah = Math.round(cents / 100);
  return rupiah.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });
}

// Parse a user-typed IDR string (e.g. "Rp 50.000" or "50000") to cents.
export function parseIDR(input: string): number {
  if (!input) return 0;
  // Strip everything that is not a digit or minus sign.
  const cleaned = String(input).replace(/[^0-9-]/g, '');
  const num = parseInt(cleaned, 10);
  if (Number.isNaN(num)) return 0;
  return Math.round(num * 100);
}

// Convenience: bare number without currency symbol.
export function formatNumber(cents: number): string {
  return Math.round(cents / 100).toLocaleString('id-ID');
}
