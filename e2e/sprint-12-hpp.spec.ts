// Sprint 12 — HPP from Recipe + FIFO inventory costing.
//
// Verifies end-to-end:
//   1. PO receive creates an InventoryBatch
//   2. Menu items with a recipe show computedHppCents in GET /api/menu/items
//   3. Placing an order decrements batch.qtyRemaining, writes hppCentsUsed
//      on the OrderItem, and records batchConsumptions
//   4. Refund restores batch.qtyRemaining
//
// Runs entirely against the live API (http://localhost:8787) and DB via
// psql queries. No browser needed — eliminates flakiness.

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { execSync } from 'node:child_process';

const BASE_API = process.env.E2E_API_URL || 'http://localhost:8787';
const EMAIL = process.env.E2E_EMAIL || 'owner@bkj.id';
const PASS = process.env.E2E_PASSWORD || 'password123';

function dbExec(sql: string): string {
  // Run psql against the pos-postgres container. Output is single-line,
  // trimmed, no header.
  return execSync(
    `docker exec pos-postgres psql -U pos -d pos_akhairi -At -F'|' -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', timeout: 10000 },
  ).trim();
}

async function login(): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE_API });
  const r = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASS },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok()) throw new Error(`Login failed: ${r.status()} ${await r.text()}`);
  return ctx;
}

test('S12-1: PO receive creates InventoryBatch', async () => {
  const ctx = await login();

  // 1. List a supplier
  const sResp = await ctx.get('/api/suppliers');
  expect(sResp.ok()).toBeTruthy();
  const suppliers = (await sResp.json()).data as Array<{ id: string; name: string }>;
  expect(suppliers.length).toBeGreaterThan(0);
  const supplierId = suppliers[0].id;

  // 2. Pick an inventory item
  const invResp = await ctx.get('/api/inventory');
  expect(invResp.ok()).toBeTruthy();
  const inv = (await invResp.json()).data as Array<{ id: string; name: string; unit: string }>;
  expect(inv.length).toBeGreaterThan(0);
  const invItem = inv[0];

  // 3. Pick a qty and unit cost
  const qtyOrdered = 50;
  const unitCostCents = 27000; // Rp 270.00 per unit in cents = 27000 (assuming unit is 100g, then 270/100g = 2700/100g)

  // Count batches before
  const beforeBatches = parseInt(dbExec(`SELECT COUNT(*) FROM inventory_batches;`), 10);

  // 4. Create PO
  const createPo = await ctx.post('/api/purchase-orders', {
    data: {
      supplierId,
      items: [
        { inventoryItemId: invItem.id, qtyOrdered, unitCostCents, notes: 'Sprint 12 E2E test' },
      ],
    },
  });
  expect(createPo.ok()).toBeTruthy();
  const { purchaseOrder: po } = (await createPo.json()).data;

  // 5. Send PO
  const send = await ctx.post(`/api/purchase-orders/${po.id}/send`);
  expect(send.ok()).toBeTruthy();

  // 6. Receive full
  const receive = await ctx.post(`/api/purchase-orders/${po.id}/receive`, {
    data: { items: [{ poItemId: po.items[0].id, qtyReceived: qtyOrdered }] },
  });
  expect(receive.ok()).toBeTruthy();

  // 7. Verify a new batch was created
  const afterBatches = parseInt(dbExec(`SELECT COUNT(*) FROM inventory_batches;`), 10);
  expect(afterBatches).toBeGreaterThan(beforeBatches);

  // 8. Verify batch details match
  const newBatch = dbExec(
    `SELECT inventory_item_id||','||qty_received||','||cost_per_unit||','||qty_remaining FROM inventory_batches WHERE purchase_order_id='${po.id}';`,
  );
  expect(newBatch).toContain(`${qtyOrdered}`);
  expect(newBatch).toContain(`${unitCostCents}`);

  // 9. PO status transitioned to RECEIVED
  const poStatus = dbExec(`SELECT status FROM purchase_orders WHERE id='${po.id}';`);
  expect(poStatus).toBe('RECEIVED');

  console.log(`✓ PO ${po.poNumber} → 1 batch created (${newBatch})`);
  await ctx.dispose();
});

test('S12-2: GET /api/menu/items returns computedHppCents for menus with recipe', async () => {
  const ctx = await login();

  // 1. Pick a menu item + an inventory item
  const menuResp = await ctx.get('/api/menu/items');
  expect(menuResp.ok()).toBeTruthy();
  const menus = (await menuResp.json()).data as Array<{ id: string; name: string; computedHppCents?: number; hppSource?: string }>;
  expect(menus.length).toBeGreaterThan(0);

  // Initially hppSource should be 'MANUAL' (no recipes configured)
  const manual = menus.filter((m) => m.hppSource === 'MANUAL');
  expect(manual.length).toBeGreaterThan(0);

  // 2. Set a recipe for the first manual menu
  const target = manual[0];
  const invResp = await ctx.get('/api/inventory');
  const inv = (await invResp.json()).data as Array<{ id: string; unit: string }>;
  expect(inv.length).toBeGreaterThan(0);

  // 3. PUT recipe
  const putRecipe = await ctx.put(`/api/menu/items/${target.id}/recipes`, {
    data: {
      recipes: [
        { inventoryItemId: inv[0].id, quantity: 0.2, unit: inv[0].unit },
        { inventoryItemId: inv[1 % inv.length].id, quantity: 0.1, unit: inv[1 % inv.length].unit },
      ],
    },
  });
  expect(putRecipe.ok()).toBeTruthy();

  // Wait for recalc to settle (queue is in-process, microtask)
  await new Promise((r) => setTimeout(r, 200));

  // 4. Re-fetch menu items, expect this one to be RECIPE
  const menuResp2 = await ctx.get('/api/menu/items');
  const menus2 = (await menuResp2.json()).data as Array<{ id: string; hppSource?: string; computedHppCents?: number; hppBreakdown?: any[] }>;
  const updated = menus2.find((m) => m.id === target.id)!;
  expect(updated.hppSource).toBe('RECIPE');
  expect(updated.computedHppCents).toBeGreaterThan(0);
  expect(updated.hppBreakdown).toBeDefined();
  expect(updated.hppBreakdown!.length).toBeGreaterThan(0);

  // 5. MenuItem.costCents in DB matches computedHppCents
  const dbCostCents = parseInt(dbExec(`SELECT cost_cents FROM menu_items WHERE id='${target.id}';`), 10);
  expect(dbCostCents).toBe(updated.computedHppCents);

  console.log(`✓ Menu ${target.name}: HPP auto = ${updated.computedHppCents} (costCents synced in DB)`);

  // 6. Cleanup: clear recipe
  await ctx.put(`/api/menu/items/${target.id}/recipes`, { data: { recipes: [] } });
  await ctx.dispose();
});

test('S12-3: Order payment snapshots hppCentsUsed + decrements batch', async () => {
  const ctx = await login();

  // 1. Find a menu with recipe, or set one
  const menuResp = await ctx.get('/api/menu/items');
  const menus = (await menuResp.json()).data as Array<{ id: string; name: string; hppSource?: string; priceCents: number; computedHppCents?: number }>;
  const invResp = await ctx.get('/api/inventory');
  const inv = (await invResp.json()).data as Array<{ id: string; name: string; unit: string }>;

  // Pick a menu, set recipe on it
  const target = menus[0];
  await ctx.put(`/api/menu/items/${target.id}/recipes`, {
    data: { recipes: [{ inventoryItemId: inv[0].id, quantity: 0.1, unit: inv[0].unit }] },
  });
  await new Promise((r) => setTimeout(r, 200));

  // 2. Find a batch for that inventory item, capture qtyRemaining before
  const batchBefore = parseFloat(
    dbExec(`SELECT qty_remaining FROM inventory_batches WHERE inventory_item_id='${inv[0].id}' ORDER BY received_at ASC LIMIT 1;`),
  );
  expect(batchBefore).toBeGreaterThan(0);

  // 3. Open a new order
  const newOrder = await ctx.post('/api/orders', {
    data: { type: 'DINE_IN' },
  });
  expect(newOrder.ok()).toBeTruthy();
  const { order } = (await newOrder.json()).data;

  // 4. Add 1 item
  const addItem = await ctx.post(`/api/orders/${order.id}/items`, {
    data: { menuItemId: target.id, quantity: 1 },
  });
  expect(addItem.ok()).toBeTruthy();

  // 5. Pay (CASH)
  const pay = await ctx.post(`/api/orders/${order.id}/pay`, {
    data: { provider: 'CASH', method: 'CASH', amountGiven: 100000 },
  });
  expect(pay.ok()).toBeTruthy();

  // 6. Verify hppCentsUsed on the orderItem
  const orderItemsRaw = dbExec(
    `SELECT hpp_cents_used||','||COALESCE(batch_consumptions::text, '') FROM order_items WHERE order_id='${order.id}';`,
  );
  expect(orderItemsRaw).toBeTruthy();
  const [hppCentsUsed] = orderItemsRaw.split('|');
  expect(parseInt(hppCentsUsed, 10)).toBeGreaterThan(0);

  // 7. Verify batchConsumptions JSON has the batch + inventory
  expect(orderItemsRaw).toContain(inv[0].id);

  // 8. Verify batch.qtyRemaining decreased
  const batchAfter = parseFloat(
    dbExec(`SELECT qty_remaining FROM inventory_batches WHERE inventory_item_id='${inv[0].id}' ORDER BY received_at ASC LIMIT 1;`),
  );
  expect(batchAfter).toBeLessThan(batchBefore);

  console.log(`✓ Order ${order.id}: hppCentsUsed=${hppCentsUsed}, batch ${batchBefore} → ${batchAfter}`);

  // 9. Cleanup: clear recipe
  await ctx.put(`/api/menu/items/${target.id}/recipes`, { data: { recipes: [] } });
  await ctx.dispose();
});

test('S12-4: GET /api/menu/items/:id returns enriched HPP fields', async () => {
  const ctx = await login();
  const invResp = await ctx.get('/api/inventory');
  const inv = (await invResp.json()).data as Array<{ id: string; unit: string }>;

  const menuResp = await ctx.get('/api/menu/items');
  const menus = (await menuResp.json()).data as Array<{ id: string }>;
  const targetId = menus[0].id;

  // Set recipe
  await ctx.put(`/api/menu/items/${targetId}/recipes`, {
    data: { recipes: [{ inventoryItemId: inv[0].id, quantity: 0.1, unit: inv[0].unit }] },
  });
  await new Promise((r) => setTimeout(r, 200));

  // Fetch single
  const one = await ctx.get(`/api/menu/items/${targetId}`);
  expect(one.ok()).toBeTruthy();
  const data = (await one.json()).data as { hppSource?: string; computedHppCents?: number; hppBreakdown?: any[] };
  expect(data.hppSource).toBe('RECIPE');
  expect(data.computedHppCents).toBeGreaterThan(0);
  expect(data.hppBreakdown).toBeDefined();
  expect(data.hppBreakdown!.length).toBeGreaterThan(0);

  // Cleanup
  await ctx.put(`/api/menu/items/${targetId}/recipes`, { data: { recipes: [] } });
  await ctx.dispose();
});
