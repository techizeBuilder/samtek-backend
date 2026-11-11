// Cascade orders deliver to their parent order, not to stock (serial number
// work step 1, 2026-10-31 — docs/serial number work/cascade-to-parent-logic-2026-10.md).
//
// A Child Part / Sub Child Part order raised by a parent order's cascade
// (demandRefId) is built for that parent's SHORTFALL after free stock (P1).
// When its parts finish they go straight onto the parent's Material List line
// — counted as issued and received in Production — instead of into stock
// where the parent would take "any" one. What the parent no longer needs
// (over-delivery), a parent that's gone / Completed, and every order made
// before this (deliverToParent false) → stock, exactly as before.
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { reserveForOrder } from './materialReservationService.js';
import { issueLimit } from './outsourceEarmarkService.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const same = (a, b) => String(a?._id || a) === String(b?._id || b);

// ── Pure ──────────────────────────────────────────────────────────────────

// How much of a finished qty the parent still takes, and what's left for stock.
export function splitDelivery(cover, qty) {
  const left = Math.max(0, r3((Number(cover?.qty) || 0) - (Number(cover?.delivered) || 0)));
  const toParent = Math.min(Math.max(0, Number(qty) || 0), left);
  return { toParent: r3(toParent), toStock: r3((Number(qty) || 0) - toParent) };
}

// The cover for a part on a parent order (null when none).
export const coverFor = (parent, partItem) => (parent?.cascadeCovers || []).find(c => same(c.partItem, partItem)) || null;

// A Material List row's cascade part (by the row's demand key = the part's
// code): { covered, delivered, left, orders } or null. covered = what the
// cascade builds for this order, so Store is asked only for the rest.
export function cascadeOnRow(order, code) {
  const c = (order?.cascadeCovers || []).find(x => x.partCode === code);
  if (!c || !(Number(c.qty) > 0)) return null;
  const covered = r3(c.qty);
  const delivered = r3(c.delivered);
  return { covered, delivered, left: r3(Math.max(0, covered - delivered)), viaStore: !!c.viaStore, orders: (c.orders || []).map(o => o.orderNo).filter(Boolean) };
}

// What Production may ask Store for on a row. The covered part is never asked
// for. A part coming through Store is also inside the plan's Store figure for
// vendors, so it isn't subtracted twice.
export function cascadeIssueLimit(issueTotal, cascade, storeForVendors, issueUnit) {
  const covered = Number(cascade?.covered) || 0;
  const store = Number(storeForVendors) || 0;
  return issueLimit((Number(issueTotal) || 0) - covered, cascade?.viaStore ? Math.max(0, store - covered) : store, issueUnit);
}

// Comes back through Store + QC rather than off Production's floor: a job-work
// order, or a production order whose last step is outsourced. Needs the
// order's processes[].type.
export function finishedViaStore(order, model = 'ProductionOrder') {
  if (model === 'SubChildPartJobWorkOrder') return true;
  const procs = order?.processes || [];
  return procs[procs.length - 1]?.type === 'Outsourcing';
}

// Is the next open step using these BOM lines an outsourced one not yet sent,
// on any unit? unitsProcesses: one processes[] per unit.
export function usedNextOnOutsourcedStep(unitsProcesses, lineIds) {
  const ids = new Set((lineIds || []).map(String));
  return (unitsProcesses || []).some((procs) => {
    const next = (procs || []).find(p => p.status !== 'Completed' && (p.materialRefs || []).some(r => ids.has(String(r))));
    return next?.type === 'Outsourcing' && !['Sent', 'Received'].includes(next.outsourceStatus);
  });
}

// The reservation line a part has on its parent (the cascades' own keys).
const partLineKey = (item) => `${item.productKind === 'ChildPart' ? 'cp' : 'scp'}:${item.code}`;

// The parent's step using this part goes to a vendor. Dynamic import: step
// material pulls in the reorder services, which import this file.
async function partUsedOnOutsourcedStep(parent, itemId, companyId) {
  const { bomLinesForOrder } = await import('./stepMaterialService.js');
  const found = await bomLinesForOrder(parent, companyId);
  const lineIds = (found?.materials || []).filter(m => same(m.subChildPart || m.childPart, itemId)).map(m => m._id);
  if (!lineIds.length) return false;
  return usedNextOnOutsourcedStep([parent.processes, ...(parent.extraUnits || []).map(u => u.processes)], lineIds);
}

// ── The parent's cover ────────────────────────────────────────────────────

// Records (or updates) what a cascade order builds for its parent. qty = the
// shortfall the cascade covers. child = { model, orderRef, orderNo }.
export async function recordCascadeCover(parentId, { partItem, partCode, partName, unit, qty, child, viaStore = false }) {
  if (!parentId || !partItem) return;
  const r = await ProductionOrder.updateOne(
    { _id: parentId, 'cascadeCovers.partItem': partItem },
    { $set: { 'cascadeCovers.$.qty': r3(qty), 'cascadeCovers.$.viaStore': !!viaStore } },
  );
  if (!r.matchedCount) {
    await ProductionOrder.updateOne({ _id: parentId }, { $push: { cascadeCovers: { partItem, partCode, partName, unit, qty: r3(qty), delivered: 0, viaStore: !!viaStore, orders: child ? [child] : [], deliveries: [] } } });
    return;
  }
  await addCoverOrder(parentId, partItem, child);
}

// A replacement order now builds part of this cover: named on the parent's row.
export async function addCoverOrder(parentId, partItem, child) {
  if (!parentId || !child?.orderRef) return;
  await ProductionOrder.updateOne(
    { _id: parentId, cascadeCovers: { $elemMatch: { partItem, 'orders.orderRef': { $ne: child.orderRef } } } },
    { $push: { 'cascadeCovers.$.orders': child } },
  );
}

// Pieces that were scrapped / lost got no replacement order (e.g. the part was
// switched to Bought after the order was raised): nothing is coming for them,
// so the parent's cover goes down and Issue opens again. A bought, released
// part also gets a purchase request, held for the parent when it arrives.
export async function coverNotReplaced(holder, item, qty) {
  const n = r3(qty);
  if (!(n > 0) || !holder?.deliverToParent || !holder.demandRefId || !item) return;
  const parent = await ProductionOrder.findOne({ _id: holder.demandRefId, company: holder.company }).select('orderId status cascadeCovers').lean();
  if (!parent || parent.status === 'Completed') return;
  const cover = coverFor(parent, item._id);
  if (!cover) return;
  await ProductionOrder.updateOne(
    { _id: parent._id, 'cascadeCovers.partItem': item._id },
    { $set: { 'cascadeCovers.$.qty': r3(Math.max(Number(cover.delivered) || 0, (Number(cover.qty) || 0) - n)) } },
  );
  const { isBought } = await import('./makeBuyService.js');
  const { isReleased } = await import('./productApprovalService.js');
  if (!isBought(item)) return;
  if (!isReleased(item)) {
    console.warn(`[CascadeDelivery] ${parent.orderId}: no purchase request for ${item.code} (bought), short ${n} — not released yet.`);
    return;
  }
  const { raisePlainPurchaseRequest } = await import('./materialAvailabilityService.js');
  await raisePlainPurchaseRequest({ item, shortfallQty: n, order: parent });
  await reserveForOrder({ item, qty: n, order: parent, companyId: holder.company, lineKey: partLineKey(item) });
}

// ── Delivery (every finish point calls this instead of adding to stock) ──

// order: the finished cascade order; model: 'ProductionOrder' (default) or
// 'SubChildPartJobWorkOrder'. itemId: the part. qty: the parts that just
// finished. by: who finished them. Never throws: the stock credit is the fallback.
export async function deliverFinishedParts({ order, model = 'ProductionOrder', itemId, qty, by = '' }) {
  const n = r3(qty);
  if (!(n > 0) || !itemId) return { toParent: 0, toStock: 0 };
  const companyId = order?.company;
  const toStock = async (q) => {
    if (!(q > 0)) return;
    await Item.updateOne({ _id: itemId, ...(companyId ? { companyId } : {}) }, { $inc: { qty: q } });
    // Serial number work step 2 (§5.4): parts holding tracked serials that
    // pool in stock wait for a sticker.
    const { registerStockCarriers } = await import('./serialTrailService.js');
    await registerStockCarriers({ order, itemId, qty: q, by });
  };
  try {
    if (!order?.deliverToParent || !order.demandRefId) { await toStock(n); return { toParent: 0, toStock: n }; }
    const parent = await ProductionOrder.findOne({ _id: order.demandRefId, company: companyId })
      .select('orderId status orderKind machineCode machineName subChildPartItem processes extraUnits cascadeCovers materialDemands.materialCode').lean();
    const cover = coverFor(parent, itemId);
    // Safety net (P2): the parent is gone (Store re-route) or already done.
    if (!parent || parent.status === 'Completed' || !cover) { await toStock(n); return { toParent: 0, toStock: n }; }

    const split = splitDelivery(cover, n);
    if (split.toParent > 0) {
      const item = await Item.findById(itemId).select('code name unit productKind').lean();
      const code = cover.partCode || item?.code;
      const has = (parent.materialDemands || []).some(d => d.materialCode === code);
      const t = split.toParent;
      // Back through Store, and the parent's next step using it goes to a
      // vendor: it waits at Store, held for the parent, and Store hands it to
      // Dispatch (the outsource v2 slice 7 rule). No sticker: it isn't pooling.
      const atStore = finishedViaStore(order, model) && await partUsedOnOutsourcedStep(parent, itemId, companyId);
      if (atStore) {
        await Item.updateOne({ _id: itemId, ...(companyId ? { companyId } : {}) }, { $inc: { qty: t } });
        await reserveForOrder({ item: { _id: itemId }, qty: t, order: parent, companyId, lineKey: partLineKey({ productKind: item?.productKind, code: item?.code || code }) });
      } else if (has) {
        await ProductionOrder.updateOne(
          { _id: parent._id, 'materialDemands.materialCode': code },
          { $inc: { 'materialDemands.$.quantity': t, 'materialDemands.$.transferredQuantity': t, 'materialDemands.$.issuedQuantity': t, 'materialDemands.$.cascadeDeliveredQuantity': t } },
        );
        // Fully received → Issued (a Store part still on its way keeps it open).
        const fresh = await ProductionOrder.findOne({ _id: parent._id }, { materialDemands: { $elemMatch: { materialCode: code } } }).lean();
        const d = fresh?.materialDemands?.[0];
        if (d && d.issuedQuantity >= d.quantity && d.status !== 'Issued') {
          await ProductionOrder.updateOne({ _id: parent._id, 'materialDemands.materialCode': code }, { $set: { 'materialDemands.$.status': 'Issued' } });
        }
      } else {
        await ProductionOrder.updateOne({ _id: parent._id }, { $push: { materialDemands: {
          materialCode: code, materialName: cover.partName || item?.name || code, sourceItemCode: code,
          fabricationCategory: '', dimensionVariantId: null, bomDimensions: {}, unit: cover.unit || item?.unit || 'Pieces',
          quantity: t, transferredQuantity: t, issuedQuantity: t, cascadeDeliveredQuantity: t, status: 'Issued',
        } } });
      }
      await ProductionOrder.updateOne(
        { _id: parent._id, 'cascadeCovers.partItem': itemId },
        { $inc: { 'cascadeCovers.$.delivered': t }, $push: { 'cascadeCovers.$.deliveries': { orderNo: order.orderId, qty: t, at: new Date(), by, ...(atStore ? { atStore: true } : {}) } } },
      );
      const Model = model === 'SubChildPartJobWorkOrder' ? SubChildPartJobWorkOrder : ProductionOrder;
      await Model.updateOne({ _id: order._id }, { $inc: { deliveredToParentQty: t } });
    }
    await toStock(split.toStock);
    return { ...split, parentOrderId: parent._id, parentOrderNo: parent.orderId };
  } catch (e) {
    console.error('[CascadeDelivery] delivery failed — to stock instead:', e.message);
    await toStock(n);
    return { toParent: 0, toStock: n, error: e.message };
  }
}

// ── Store's re-route (P2) ─────────────────────────────────────────────────

// The parent orders are about to be deleted: their direct open cascade
// children become stock orders (output → stock). Grandchildren keep
// delivering to their own parent, which still exists.
export async function detachCascadeChildren(parentIds, companyId) {
  const ids = (parentIds || []).map(x => x?._id || x).filter(Boolean);
  if (!ids.length) return 0;
  const set = { $set: { demandSource: 'LowStock', demandRefId: null, deliverToParent: false, parentOrderNo: '' } };
  const a = await ProductionOrder.updateMany({ company: companyId, demandRefId: { $in: ids }, status: { $ne: 'Completed' } }, set);
  const b = await SubChildPartJobWorkOrder.updateMany({ company: companyId, demandRefId: { $in: ids }, status: { $nin: ['Completed', 'Cancelled'] } }, set);
  return (a.modifiedCount || 0) + (b.modifiedCount || 0);
}
