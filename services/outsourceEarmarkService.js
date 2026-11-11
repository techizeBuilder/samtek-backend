// What a production order's material is set aside for outsource trips
// (outsource-v2 slice 5, 2026-10-20 — docs/outsource-v2/material-logic-2026-10.md).
// Read straight from the material plans on its live Outsource Orders — one
// source of truth: a rejected / cancelled order drops out on its own (its
// requests become Released).
//
// Deliberately tiny (only the OutsourceOrder model) so the Material List
// services (childPartReorderService / machineReorderService) can import it
// without an import cycle through the plan service.
import OutsourceOrder from '../models/OutsourceOrder.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// A plan row in the Material List's own unit (sheets for sheet metal):
//   store       — the part Store sends straight to the vendor
//   production  — the part Production hands over from what it holds
export function rowDemandUnits(row) {
  if (!row) return { store: 0, production: 0 };
  if (row.kind === 'wip') return { store: 0, production: 0 };
  if (row.kind === 'sheetArea') {
    const store = row.storeShare != null ? Number(row.storeShare) : (row.pieceSize ? (Number(row.fromStore) || 0) / row.pieceSize : 0);
    return { store, production: row.pieceSize ? (Number(row.fromProduction) || 0) / row.pieceSize : 0 };
  }
  if (row.kind === 'length') return { store: Number(row.storeShare) || 0, production: 0 };
  return { store: Number(row.fromStore) || 0, production: Number(row.fromProduction) || 0 };
}

// Per Material List line (demandKey) of one production order:
//   store            — planned from Store for vendors (never issued to Production)
//   productionHeld   — Production's part on trips that haven't gone out yet
//   productionAwaiting — of that, still being built by a cascade order
//   orders           — the OSO numbers
export async function outsourceMaterialOnOrder(productionOrderId, { excludeOrderId = null } = {}) {
  const q = { 'lines.requests.productionOrder': productionOrderId, status: { $nin: ['Cancelled', 'Rejected'] } };
  if (excludeOrderId) q._id = { $ne: excludeOrderId };
  const orders = await OutsourceOrder.find(q).select('orderNo lines.requests').lean();
  const byKey = new Map();
  for (const o of orders) {
    for (const l of o.lines || []) {
      for (const r of l.requests || []) {
        if (String(r.productionOrder) !== String(productionOrderId) || r.status === 'Released') continue;
        for (const row of r.materialPlan || []) {
          if (!row.demandKey) continue;
          const du = rowDemandUnits(row);
          const e = byKey.get(row.demandKey) || { store: 0, productionHeld: 0, productionAwaiting: 0, orders: [] };
          e.store = r3(e.store + du.store);
          if (r.status === 'Ordered') {
            e.productionHeld = r3(e.productionHeld + du.production);
            e.productionAwaiting = r3(e.productionAwaiting + (Number(row.awaitingDelivery) || 0));
          }
          if (du.store > 0 && !e.orders.includes(o.orderNo)) e.orders.push(o.orderNo);
          byKey.set(row.demandKey, e);
        }
      }
    }
  }
  return byKey;
}

// How much of a Material List line Production may still request, once the
// part going to vendors straight from Store is taken out. Whole sheets /
// pieces round up (Production can only take whole ones).
export function issueLimit(issueTotal, storeForVendors, issueUnit) {
  const left = (Number(issueTotal) || 0) - (Number(storeForVendors) || 0);
  if (/sheet|piece/i.test(String(issueUnit || ''))) return Math.max(0, Math.ceil(left - 1e-6));
  return Math.max(0, r3(left));
}
