// ESC/POS command builder. Produces a Uint8Array suitable for writing to a
// Bluetooth characteristic in 512-byte chunks. All commands are standard
// ESC/POS as supported by common 58mm/80mm thermal receipt printers.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const CMD = {
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  SIZE_NORMAL: [GS, 0x21, 0x00],
  SIZE_DOUBLE: [GS, 0x21, 0x11],
  CUT: [GS, 0x56, 0x01],
  LF: [LF],
};

function bytes(...arrays: number[][]): Uint8Array {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let p = 0;
  for (const a of arrays) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

function strBytes(s: string): number[] {
  // Most thermal printers use CP437; for Indonesian characters we send UTF-8
  // and rely on the printer's codepage fallback. Many newer printers accept
  // UTF-8 directly. If the printer shows garbage, swap to a CP437-safe set.
  const enc = new TextEncoder();
  return Array.from(enc.encode(s));
}

function pad(left: string, right: string, width: number): string {
  // Approximation: printers use proportional fonts. We pad with spaces and
  // hope for the best. Width 32 ≈ 58mm; 48 ≈ 80mm.
  const gap = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(gap) + right;
}

export interface ReceiptLineItem {
  quantity: number;
  name: string;
  priceCents: number;
}

export interface ReceiptData {
  header: string; // shop name
  orderNumber: string;
  orderType?: string;
  tableNumber?: string | null;
  customerName?: string | null;
  cashierName?: string | null;
  items: ReceiptLineItem[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  amountGivenCents?: number;
  changeCents?: number;
  paymentMethod?: string;
  footer?: string;
  /** Approximate line width in characters (32 for 58mm, 48 for 80mm). */
  width?: number;
}

const DEFAULT_WIDTH = 32;

export function buildReceipt(d: ReceiptData): Uint8Array {
  const w = d.width ?? DEFAULT_WIDTH;
  const parts: number[][] = [];

  // Reset
  parts.push(CMD.INIT);

  // Header (centered, double size, bold)
  parts.push(CMD.ALIGN_CENTER, CMD.SIZE_DOUBLE, CMD.BOLD_ON);
  parts.push(strBytes(d.header));
  parts.push(CMD.LF, CMD.BOLD_OFF, CMD.SIZE_NORMAL);

  // Order meta (centered)
  parts.push(CMD.ALIGN_CENTER);
  parts.push(strBytes(`No. ${d.orderNumber}`));
  parts.push(CMD.LF);
  if (d.orderType) {
    parts.push(strBytes(d.orderType));
    parts.push(CMD.LF);
  }
  if (d.tableNumber) {
    parts.push(strBytes(`Meja ${d.tableNumber}`));
    parts.push(CMD.LF);
  }
  if (d.customerName) {
    parts.push(strBytes(d.customerName));
    parts.push(CMD.LF);
  }
  parts.push(strBytes(new Date().toLocaleString('id-ID')));
  parts.push(CMD.LF);

  // Divider
  parts.push(CMD.ALIGN_LEFT);
  parts.push(strBytes('-'.repeat(w)));
  parts.push(CMD.LF);

  // Items
  for (const it of d.items) {
    const nameLine = `${it.quantity}x ${it.name}`;
    parts.push(strBytes(nameLine.length > w ? nameLine.slice(0, w - 1) + '…' : nameLine));
    parts.push(CMD.LF);
    const left = '  ';
    const right = formatIDRPlain(it.priceCents);
    const line = pad(left, right, w);
    parts.push(strBytes(line));
    parts.push(CMD.LF);
  }

  parts.push(strBytes('-'.repeat(w)));
  parts.push(CMD.LF);

  // Totals
  parts.push(strBytes(pad('Subtotal', formatIDRPlain(d.subtotalCents), w)));
  parts.push(CMD.LF);
  parts.push(strBytes(pad('Pajak', formatIDRPlain(d.taxCents), w)));
  parts.push(CMD.LF);
  if (d.discountCents > 0) {
    parts.push(strBytes(pad('Diskon', '-' + formatIDRPlain(d.discountCents), w)));
    parts.push(CMD.LF);
  }
  parts.push(CMD.BOLD_ON, CMD.SIZE_DOUBLE);
  parts.push(strBytes(pad('TOTAL', formatIDRPlain(d.totalCents), w)));
  parts.push(CMD.LF, CMD.BOLD_OFF, CMD.SIZE_NORMAL);

  // Payment
  if (d.paymentMethod) {
    parts.push(strBytes(pad('Bayar', d.paymentMethod, w)));
    parts.push(CMD.LF);
  }
  if (typeof d.amountGivenCents === 'number') {
    parts.push(strBytes(pad('Tunai', formatIDRPlain(d.amountGivenCents), w)));
    parts.push(CMD.LF);
  }
  if (typeof d.changeCents === 'number') {
    parts.push(strBytes(pad('Kembali', formatIDRPlain(d.changeCents), w)));
    parts.push(CMD.LF);
  }

  parts.push(strBytes('-'.repeat(w)));
  parts.push(CMD.LF);

  // Footer
  parts.push(CMD.ALIGN_CENTER);
  parts.push(strBytes(d.footer ?? 'Terima kasih!'));
  parts.push(CMD.LF, CMD.LF, CMD.LF);

  // Cut
  parts.push(CMD.CUT);

  return bytes(...parts);
}

function formatIDRPlain(cents: number): string {
  return 'Rp ' + Math.round(cents / 100).toLocaleString('id-ID');
}

/**
 * Slice a buffer into N <=512-byte chunks (most BLE characteristics cap at
 * 20-byte ATT MTU; the Web Bluetooth stack will further fragment, so we
 * keep chunks small to be safe across devices).
 */
export function chunkForBluetooth(buf: Uint8Array, chunkSize = 100): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < buf.length; i += chunkSize) {
    out.push(buf.slice(i, Math.min(i + chunkSize, buf.length)));
  }
  return out;
}
