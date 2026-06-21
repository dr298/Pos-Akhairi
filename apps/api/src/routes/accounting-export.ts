// apps/api/src/routes/accounting-export.ts
//
// Sprint 9.7 — Accounting Integration Export (Jurnal / Accurate / Mekari).
//
// The three Indonesian accounting SaaS all support CSV/XLSX import. The
// "integration" is just generating the right column order. We support four
// preset formats + a generic one:
//
//   JURNAL   — Jurnal by Mekari (https:// Mekari Jurnal). The most common
//              Indonesian SMB accounting app. Sales journal import format:
//                Tanggal | Nomor Bukti | Deskripsi | Akun | Debit | Kredit | Catatan
//              Purchase journal:
//                Tanggal | Nomor Bukti | Supplier | Deskripsi | Akun | Debit | Kredit
//
//   ACCURATE — Accurate Online. Sales journal import:
//                TANGGAL | NO. BUKTI | KETERANGAN | DEBIT | KREDIT | AKUN
//              Purchase journal:
//                TANGGAL | NO. BUKTI | SUPPLIER | KETERANGAN | DEBIT | KREDIT | AKUN
//
//   MEKARI   — Mekari Jurnal alternative import (older Mekari accounting
//              product, pre-2022). Format similar to JURNAL but with English
//              column headers and an extra "Project" column at the end.
//
//   GENERIC  — Our own canonical export. Date, Restaurant Code, Order#,
//              Type, Amount (cents), Tax, Total, Payment. The simplest
//              format for ad-hoc uploads. This is the one that survives
//              format changes in the SaaS products.
//
// All formats use a header row + data rows, with CRLF line endings (Excel-
// friendly), UTF-8 with BOM (so Excel reads accented characters correctly),
// and standard CSV escaping (double-quote any field containing comma,
// quote, or newline; double-up internal quotes).
//
// Endpoints (all require auth, OWNER+MANAGER):
//   GET /api/accounting-export/sales-journal.csv
//        ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=JURNAL
//   GET /api/accounting-export/purchase-journal.csv
//        ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=JURNAL
//
// Data sources:
//   - sales-journal: paid Order rows (one row per order) + the
//     subtotal/tax/discount/total breakdown. Payment method is included as a
//     "Description" suffix for the cash/bank split suggestion.
//   - purchase-journal: PurchaseOrderItem rows on POs with status RECEIVED or
//     PARTIAL, joined to the PO header for supplier + date. One row per
//     PO line item.

import { Hono, type Context } from 'hono';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const accountingExportRoutes = new Hono<AppEnv>();

accountingExportRoutes.use('*', requireAuth, requireRole('OWNER', 'MANAGER'));

// Single-restaurant deployment. The legacy `branch_code` column is kept
// in the export for downstream template compatibility — it always emits
// this constant value.
const RESTAURANT_CODE = 'MAIN';
const RESTAURANT_NAME = 'Main Restaurant';

// ─── Types ────────────────────────────────────────────────────────────────

export type ExportFormat = 'JURNAL' | 'ACCURATE' | 'MEKARI' | 'GENERIC';

const VALID_FORMATS: ReadonlyArray<ExportFormat> = ['JURNAL', 'ACCURATE', 'MEKARI', 'GENERIC'];

// Default Indonesian chart-of-accounts used in the suggested journal lines.
// These are advisory placeholders; the real mapping is configured per tenant
// in the accounting SaaS's import template. We use common Indonesian CoA
// codes so the import usually lands on the right account.
const COA = {
  // Sales side
  salesRevenue: '4000',          // Penjualan
  salesDiscount: '4100',         // Diskon Penjualan
  salesTaxOuput: '2100',         // PPN Keluaran
  // Cash/bank side
  cash: '1100',                  // Kas
  bank: '1200',                  // Bank
  // Purchase side
  purchaseInventory: '1300',     // Persediaan Bahan Baku / Inventory
  purchaseVatInput: '2200',      // PPN Masukan
  accountsPayable: '2000',       // Hutang Usaha
  purchaseExpense: '5000',       // Beban Bahan Baku (consumed)
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseDateOnly(input: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) throw new Error(`Invalid date string: ${input} (expected YYYY-MM-DD)`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return d;
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function parseFormat(input: string | undefined): ExportFormat {
  const v = (input || 'JURNAL').toUpperCase();
  if ((VALID_FORMATS as ReadonlyArray<string>).includes(v)) {
    return v as ExportFormat;
  }
  throw new Error(`Invalid format "${input}". Use one of: ${VALID_FORMATS.join(', ')}`);
}

function parsePaymentMethodForCoa(method: string | null | undefined): string {
  // Suggest a CoA for the cash/bank side of a sales entry. The accounting
  // team can change it on import, but the default gets them 80% of the way.
  const m = (method || '').toUpperCase();
  if (m === 'CASH') return COA.cash;
  if (m === 'QRIS' || m === 'EWALLET' || m === 'DEBIT' || m === 'CREDIT') return COA.bank;
  // VOID/REFUND/OTHER — fall through to cash.
  return COA.cash;
}

function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Quote if it contains comma, double-quote, newline, or carriage return.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  // CRLF + UTF-8 BOM (Excel-friendly, plays well with Indonesian accented
  // text in supplier names).
  const body = rows.map((r) => r.map(csvField).join(',')).join('\r\n');
  return '\ufeff' + body + '\r\n';
}

function csvResponse(c: Context, filename: string, body: string) {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Cache-Control', 'no-store');
  return c.body(body);
}

function dateId(d: Date): string {
  // YYYY-MM-DD in local time (no TZ math — Jakarta is fine for the
  // accounting export, since the user is also looking at this on a
  // Jakarta-clock server).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rupiahFromCents(cents: number | null | undefined): number {
  // CSV-friendly: store as a plain number (IDR, no decimals). User can
  // apply thousand-separator formatting in Excel.
  if (!cents && cents !== 0) return 0;
  return Math.round(cents / 1); // already integer cents; keep as-is
}

// ─── Sales journal ────────────────────────────────────────────────────────

async function buildSalesJournal(
  start: Date,
  end: Date,
  format: ExportFormat,
): Promise<ReadonlyArray<ReadonlyArray<unknown>>> {
  const orders = await prisma.order.findMany({
    where: {
      status: 'PAID',
      closedAt: { gte: start, lte: end },
    },
    include: {
      payments: { where: { status: 'PAID' }, orderBy: { paidAt: 'asc' } },
    },
    orderBy: { closedAt: 'asc' },
  });

  // Format-specific column layouts. The first row is the header.
  // Each data row is one journal entry — for sales, we emit 3 lines per
  // order: 1) debit cash/bank, 2) credit revenue, 3) credit PPN output.
  // (Discount gets folded into a single net-revenue credit line for JURNAL
  // and Mekari; Accurate expects the breakdown explicitly.)
  let header: ReadonlyArray<unknown>;
  let body: unknown[][] = [];
  let saleCounter = 0;

  if (format === 'JURNAL') {
    header = ['Tanggal', 'Nomor Bukti', 'Deskripsi', 'Akun', 'Debit', 'Kredit', 'Catatan'];
    for (const o of orders) {
      const date = o.closedAt ? dateId(o.closedAt) : dateId(o.openedAt);
      const num = o.orderNumber;
      const desc = `Penjualan ${RESTAURANT_NAME} #${num}`;
      const cashMethod = o.payments[0]?.method ?? 'CASH';
      const cashCoa = parsePaymentMethodForCoa(cashMethod);
      const netRevenue = rupiahFromCents(o.subtotalCents - o.discountCents);
      const taxCents = rupiahFromCents(o.taxCents);
      const totalCents = rupiahFromCents(o.totalCents);

      // Debit: cash/bank for the full total
      body.push([date, num, desc, cashCoa, totalCents, 0, `Metode: ${cashMethod}`]);
      saleCounter++;
      // Credit: revenue (net of discount)
      if (netRevenue > 0) {
        body.push([date, num, desc, COA.salesRevenue, 0, netRevenue, '']);
      }
      // Credit: PPN keluaran (output VAT)
      if (taxCents > 0) {
        body.push([date, num, `${desc} (PPN)`, COA.salesTaxOuput, 0, taxCents, '']);
      }
      // If discount was applied, debit the discount account to balance
      if (o.discountCents > 0) {
        body.push([
          date,
          num,
          `${desc} (Diskon)`,
          COA.salesDiscount,
          rupiahFromCents(o.discountCents),
          0,
          '',
        ]);
      }
    }
  } else if (format === 'ACCURATE') {
    header = ['Tanggal', 'No. Bukti', 'Keterangan', 'Debit', 'Kredit', 'Akun'];
    for (const o of orders) {
      const date = o.closedAt ? dateId(o.closedAt) : dateId(o.openedAt);
      const num = o.orderNumber;
      const ket = `Penjualan ${RESTAURANT_NAME} #${num}`;
      const cashMethod = o.payments[0]?.method ?? 'CASH';
      const cashCoa = parsePaymentMethodForCoa(cashMethod);
      const totalCents = rupiahFromCents(o.totalCents);
      body.push([date, num, ket, totalCents, 0, cashCoa]);
      saleCounter++;
      body.push([date, num, ket, 0, rupiahFromCents(o.subtotalCents - o.discountCents), COA.salesRevenue]);
      if (o.taxCents > 0) {
        body.push([date, num, `${ket} PPN`, 0, rupiahFromCents(o.taxCents), COA.salesTaxOuput]);
      }
      if (o.discountCents > 0) {
        body.push([
          date,
          num,
          `${ket} Diskon`,
          rupiahFromCents(o.discountCents),
          0,
          COA.salesDiscount,
        ]);
      }
    }
  } else if (format === 'MEKARI') {
    header = ['Date', 'Ref No', 'Description', 'Account', 'Debit', 'Credit', 'Project'];
    for (const o of orders) {
      const date = o.closedAt ? dateId(o.closedAt) : dateId(o.openedAt);
      const num = o.orderNumber;
      const desc = `Penjualan ${RESTAURANT_NAME} #${num}`;
      const cashMethod = o.payments[0]?.method ?? 'CASH';
      const cashCoa = parsePaymentMethodForCoa(cashMethod);
      const project = RESTAURANT_CODE;
      const totalCents = rupiahFromCents(o.totalCents);
      body.push([date, num, desc, cashCoa, totalCents, 0, project]);
      saleCounter++;
      body.push([
        date,
        num,
        desc,
        COA.salesRevenue,
        0,
        rupiahFromCents(o.subtotalCents - o.discountCents),
        project,
      ]);
      if (o.taxCents > 0) {
        body.push([date, num, `${desc} PPN`, COA.salesTaxOuput, 0, rupiahFromCents(o.taxCents), project]);
      }
      if (o.discountCents > 0) {
        body.push([
          date,
          num,
          `${desc} Diskon`,
          COA.salesDiscount,
          rupiahFromCents(o.discountCents),
          0,
          project,
        ]);
      }
    }
  } else {
    // GENERIC
    header = ['date', 'restaurant_code', 'order_number', 'payment_method', 'subtotal_cents', 'discount_cents', 'tax_cents', 'total_cents'];
    for (const o of orders) {
      const date = o.closedAt ? dateId(o.closedAt) : dateId(o.openedAt);
      const method = o.payments[0]?.method ?? '';
      body.push([
        date,
        RESTAURANT_CODE,
        o.orderNumber,
        method,
        o.subtotalCents,
        o.discountCents,
        o.taxCents,
        o.totalCents,
      ]);
      saleCounter++;
    }
  }

  void saleCounter;
  return [header, ...body];
}

// ─── Purchase journal ─────────────────────────────────────────────────────

async function buildPurchaseJournal(
  start: Date,
  end: Date,
  format: ExportFormat,
): Promise<ReadonlyArray<ReadonlyArray<unknown>>> {
  // PO items on POs in PARTIAL or RECEIVED status. We use `receivedAt` as
  // the journal date — that's the day the inventory hit the books.
  // For PO items that have been received in multiple calls, we'd ideally
  // split by partial receives, but our model only tracks cumulative
  // qtyReceived. We emit one row per PO line for the cumulative amount.
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['PARTIAL', 'RECEIVED'] },
      receivedAt: { gte: start, lte: end },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
    orderBy: { receivedAt: 'asc' },
  });

  // For Accurate/JURNAL purchase journal we want: Debit Inventory +
  // Debit PPN Masukan, Kredit Hutang Usaha. For GENERIC: one line per
  // PO item with the totals.
  let header: ReadonlyArray<unknown>;
  let body: unknown[][] = [];

  if (format === 'JURNAL') {
    header = ['Tanggal', 'Nomor Bukti', 'Supplier', 'Deskripsi', 'Akun', 'Debit', 'Kredit'];
    for (const po of pos) {
      if (!po.receivedAt) continue;
      const date = dateId(po.receivedAt);
      const num = po.poNumber;
      const supplier = po.supplier.name;
      const desc = `Pembelian ${RESTAURANT_NAME} #${num}`;
      const totalCents = rupiahFromCents(Number(po.totalCents));
      // Debit Inventory (gross — VAT is folded into inventory cost for
      // non-PPN-registered businesses. For PPN-registered ones, separate
      // the VAT into PPN Masukan.)
      body.push([date, num, supplier, desc, COA.purchaseInventory, totalCents, 0]);
      // Credit Hutang Usaha
      body.push([date, num, supplier, desc, COA.accountsPayable, 0, totalCents]);
    }
  } else if (format === 'ACCURATE') {
    header = ['Tanggal', 'No. Bukti', 'Supplier', 'Keterangan', 'Debit', 'Kredit', 'Akun'];
    for (const po of pos) {
      if (!po.receivedAt) continue;
      const date = dateId(po.receivedAt);
      const num = po.poNumber;
      const supplier = po.supplier.name;
      const ket = `Pembelian ${RESTAURANT_NAME} #${num}`;
      const totalCents = rupiahFromCents(Number(po.totalCents));
      body.push([date, num, supplier, ket, totalCents, 0, COA.purchaseInventory]);
      body.push([date, num, supplier, ket, 0, totalCents, COA.accountsPayable]);
    }
  } else if (format === 'MEKARI') {
    header = ['Date', 'Ref No', 'Supplier', 'Description', 'Account', 'Debit', 'Credit', 'Project'];
    for (const po of pos) {
      if (!po.receivedAt) continue;
      const date = dateId(po.receivedAt);
      const num = po.poNumber;
      const supplier = po.supplier.name;
      const desc = `Pembelian ${RESTAURANT_NAME} #${num}`;
      const project = RESTAURANT_CODE;
      const totalCents = rupiahFromCents(Number(po.totalCents));
      body.push([date, num, supplier, desc, COA.purchaseInventory, totalCents, 0, project]);
      body.push([date, num, supplier, desc, COA.accountsPayable, 0, totalCents, project]);
    }
  } else {
    // GENERIC
    header = [
      'date',
      'restaurant_code',
      'po_number',
      'supplier',
      'supplier_id',
      'item_count',
      'total_cents',
    ];
    for (const po of pos) {
      if (!po.receivedAt) continue;
      const date = dateId(po.receivedAt);
      body.push([
        date,
        RESTAURANT_CODE,
        po.poNumber,
        po.supplier.name,
        po.supplier.id,
        po.items.length,
        Number(po.totalCents),
      ]);
    }
  }

  return [header, ...body];
}

// ─── Routes ───────────────────────────────────────────────────────────────

accountingExportRoutes.get('/sales-journal.csv', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) {
    return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);
  }
  let start: Date;
  let end: Date;
  try {
    start = parseDateOnly(from);
    end = endOfDay(parseDateOnly(to));
  } catch (e) {
    return fail(c, 'ValidationError', (e as Error).message, 400);
  }
  if (start > end) return fail(c, 'ValidationError', 'from must be <= to', 400);
  let format: ExportFormat;
  try {
    format = parseFormat(c.req.query('format'));
  } catch (e) {
    return fail(c, 'ValidationError', (e as Error).message, 400);
  }

  const rows = await buildSalesJournal(start, end, format);
  const csv = buildCsv(rows);
  const filename = `sales-journal_${RESTAURANT_CODE}_${from}_${to}_${format}.csv`;

  incCounter('pos_accounting_export_total', 'Accounting exports', {
    type: 'sales',
    format,
  });
  logger.info(
    { format, from, to, rowCount: rows.length - 1 },
    'accounting sales journal exported',
  );
  return csvResponse(c, filename, csv);
});

accountingExportRoutes.get('/purchase-journal.csv', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) {
    return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);
  }
  let start: Date;
  let end: Date;
  try {
    start = parseDateOnly(from);
    end = endOfDay(parseDateOnly(to));
  } catch (e) {
    return fail(c, 'ValidationError', (e as Error).message, 400);
  }
  if (start > end) return fail(c, 'ValidationError', 'from must be <= to', 400);
  let format: ExportFormat;
  try {
    format = parseFormat(c.req.query('format'));
  } catch (e) {
    return fail(c, 'ValidationError', (e as Error).message, 400);
  }

  const rows = await buildPurchaseJournal(start, end, format);
  const csv = buildCsv(rows);
  const filename = `purchase-journal_${RESTAURANT_CODE}_${from}_${to}_${format}.csv`;

  incCounter('pos_accounting_export_total', 'Accounting exports', {
    type: 'purchase',
    format,
  });
  logger.info(
    { format, from, to, rowCount: rows.length - 1 },
    'accounting purchase journal exported',
  );
  return csvResponse(c, filename, csv);
});
