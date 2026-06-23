// Sprint 21 — /pos/orders = sales order list (alias of /pos/history).
// Odoo-style nav uses "Sales > Sales Report" which points here.
// Server-side redirect to /pos/history so users get a stable canonical
// URL. The /pos/history URL still works for backward compat.

import { redirect } from 'next/navigation';

export default function SalesOrdersPage() {
  redirect('/pos/history');
}
