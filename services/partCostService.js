// A part's build cost into its BOM (outsource v2 slice 4, 2026-10-24 —
// docs/outsource-v2/slice-4-cost-logic-2026-10.md). One place for every
// level and every way an order can finish.
//
// Three numbers per build:
//   - Production cost / expense — typed by Production at the unit's LAST
//     IN-HOUSE step (saveProductionCost); ₹0 when it had none.
//   - Job work (outsource) cost — never typed: the accepted money on the
//     Outsource Orders (line amount ÷ qty per accepted piece / unit, no GST)
//     + its line's share of the order's charges (no GST). Freight isn't in it.
//
// pushPartCost() writes all three to the BOM once the TRUE LAST STEP has
// finished — whoever finishes it — and can run again safely (a late time
// entry, a QC pass after the last receive): it recomputes from scratch.
// "The latest build wins": an older build never overwrites a newer one's cost.
// Then the price push (priceCascadeService) climbs to the Machines' prices.
// Never throws to its caller — a cost hiccup must not undo stock / QC.
import { Item } from '../models/Inventory.js';
import { lostBetween } from '../utils/lostAtVendor.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import OutsourceOrder from '../models/OutsourceOrder.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import QCJob from '../models/QCJob.js';
import { getQcStepIndices } from './qcStepService.js';
import { refreshBomMaterialLines } from '../utils/bomMaterialPrice.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const unitProcs = (order, unitIndex) => (unitIndex ? order.extraUnits?.[unitIndex - 1]?.processes : order.processes);
const isOutsourcing = (p) => p?.type === 'Outsourcing';

// ── Pure ──────────────────────────────────────────────────────────────────

// The step is in-house and every step after it on this unit is outsourced —
// Production's last touch on the unit, where it types its own cost.
export function isLastInHouseStep(procs, idx) {
  const p = procs?.[idx];
  if (!p || isOutsourcing(p)) return false;
  return procs.slice(idx + 1).every(isOutsourcing);
}

// The unit's (Sub Child Part: the batch's) true last step has finished.
export function unitFinished(order, unitIndex) {
  const procs = unitProcs(order, unitIndex);
  return !!procs?.length && procs[procs.length - 1].status === 'Completed';
}

// One line's charge share per piece: the order's charges (no GST) spread over
// its lines by line amount (Q1).
export function chargePerPiece(order, line) {
  const lines = (order.lines || []).filter(l => (l.requests || []).some(r => r.status !== 'Released'));
  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const charges = (order.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  if (!(charges > 0) || !(sum > 0) || !(Number(line.qty) > 0)) return 0;
  return charges * ((Number(line.amount) || 0) / sum) / Number(line.qty);
}

const perPieceOf = (line) => (Number(line.qty) > 0 && line.amount != null ? Number(line.amount) / Number(line.qty) : Number(line.ratePerPiece) || 0);

// ── The outsourced money for a build ──────────────────────────────────────

// { money, waitingFor[] } for a production order's unit (a Sub Child Part:
// unitIndex null = the batch) or a job-work order. waitingFor = Outsource
// Orders with a received trip still not valued because a per minute / per
// hour time isn't entered yet.
// live: an Outsource Order still in memory (its caller saves it after) — used
// in place of its saved copy.
export async function outsourceMoneyFor({ productionOrder = null, jobWorkOrder = null, unitIndex = null, live = null }) {
  const { qcDecisionsOf } = await import('./outsourceBillService.js');
  const q = productionOrder ? { 'lines.requests.productionOrder': productionOrder._id } : { 'lines.requests.jobWorkOrder': jobWorkOrder._id };
  let orders = await OutsourceOrder.find({ ...q, status: { $nin: ['Rejected', 'Cancelled', 'Pending Approval'] } }).lean();
  if (live) {
    const liveObj = typeof live.toObject === 'function' ? live.toObject() : live;
    orders = [...orders.filter(o => String(o._id) !== String(liveObj._id)), liveObj];
  }
  const perUnit = productionOrder && productionOrder.orderKind !== 'SubChildPart';
  let money = 0;
  const waitingFor = new Set();
  for (const o of orders) {
    for (const line of o.lines) {
      for (const r of line.requests) {
        if (r.status === 'Released') continue;
        const mine = productionOrder ? String(r.productionOrder) === String(productionOrder._id) : String(r.jobWorkOrder) === String(jobWorkOrder._id);
        if (!mine) continue;
        if (perUnit) {
          const handoff = productionOrder.outsourceHandoffs?.find(h => String(h._id) === String(r.handoffId));
          if (!(handoff?.unitIndices || []).includes(unitIndex)) continue;
        }
        if (r.status !== 'Received') continue;
        const applied = r.acceptance?.appliedKeys || [];
        if (line.timePending && !applied.length) { waitingFor.add(o.orderNo); continue; }
        const each = perPieceOf(line) + chargePerPiece(o, line);
        if (perUnit) {
          const k = `u${unitIndex + 1}`;
          if (applied.includes('all')) { money += each; continue; }
          if (!applied.includes(k)) continue; // QC hasn't decided this unit yet
          const { parts } = await qcDecisionsOf(r);
          if (parts.find(p => p.key === k)?.accepted > 0) money += each;
        } else {
          money += each * (Number(r.acceptance?.acceptedQty) || 0);
        }
      }
    }
  }
  return { money: round2(money), waitingFor: [...waitingFor] };
}

// ── Production's own cost ─────────────────────────────────────────────────

// Stores what Production typed for a unit (a Sub Child Part: 0 = the batch).
// Atomic, so it never fights the caller's own save of the order.
export async function saveProductionCost(orderId, unitIndex, productionCost, productionExpense, byName = '') {
  const set = { productionCost: Number(productionCost) || 0, productionExpense: Number(productionExpense) || 0, enteredAt: new Date(), enteredBy: byName };
  const r = await ProductionOrder.updateOne({ _id: orderId, 'unitCosts.unitIndex': unitIndex },
    { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`unitCosts.$.${k}`, v])) });
  if (!r.matchedCount) await ProductionOrder.updateOne({ _id: orderId }, { $push: { unitCosts: { unitIndex, ...set } } });
}

export function productionCostOf(order, unitIndex) {
  const e = (order.unitCosts || []).find(u => u.unitIndex === unitIndex);
  if (e?.productionCost != null) return { cost: Number(e.productionCost) || 0, expense: Number(e.productionExpense) || 0, entered: true };
  return { cost: 0, expense: 0, entered: false };
}

// Before slice 4 the true last step's cost sat on its QC entry
// (pendingProductionCost) — still read, for anything entered that way.
async function legacyPendingCost(order, unitIndex) {
  const { qcJobSourceForOrder } = await import('../controllers/productionMfgController.js');
  const job = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: order.company }).lean();
  if (!job) return null;
  const procs = unitProcs(order, unitIndex) || [];
  const last = procs[procs.length - 1];
  if (!last) return null;
  const entry = order.orderKind === 'SubChildPart'
    ? (job.batchSteps || []).find(b => b.category === last.category && b.stepName === last.step)
    : (job.unitChecks || []).find(u => u.unitNumber === unitIndex + 1)?.steps?.find(s => s.category === last.category && s.stepName === last.step);
  if (entry?.pendingProductionCost == null) return null;
  return { cost: Number(entry.pendingProductionCost) || 0, expense: Number(entry.pendingProductionExpense) || 0 };
}

// A Sub Child Part batch's finished pieces — what went into stock: the last
// QC step's passed qty (the true last step, or the last QC step before a
// non-QC last step); no QC step → the order quantity.
async function scpFinishedQty(order) {
  const qcIdx = getQcStepIndices(order, order.processes);
  // Pieces lost at a vendor aren't finished pieces (2026-10-26).
  const end = order.processes.length - 1;
  if (!qcIdx.length) return Math.max(1, (Number(order.orderQuantity) || 1) - lostBetween(order, -1, end));
  const { qcJobSourceForOrder } = await import('../controllers/productionMfgController.js');
  const job = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: order.company }).lean();
  const lastQc = order.processes[Math.max(...qcIdx)];
  const entry = (job?.batchSteps || []).find(b => b.category === lastQc.category && b.stepName === lastQc.step);
  const survived = Number(entry?.passedQty) > 0 ? Number(entry.passedQty) : Math.max(1, Number(order.orderQuantity) || 1);
  return Math.max(1, survived - lostBetween(order, Math.max(...qcIdx), end));
}

// ── The push ──────────────────────────────────────────────────────────────

const newer = (a, b) => a && b && new Date(a) > new Date(b);

// May this build's cost go on the part? (cur = the part's costFrom.)
// "The latest build wins" — except a newer build still waiting for a per
// minute / per hour time doesn't replace a complete cost (2026-10-27, user:
// "the last complete build"); once its time is entered it replaces it.
const mayReplace = (cur, finishedAt, waiting) => {
  if (newer(cur?.finishedAt, finishedAt)) return false;
  if (waiting && cur?.finishedAt && !cur.waiting && String(cur.finishedAt) !== String(finishedAt)) return false;
  return true;
};

// One finished unit / batch of a production order → its BOM. orderRef: an id
// or the order. Re-reads the order from the database (call after saving).
export async function pushPartCost(orderRef, unitIndex = 0, { live = null } = {}) {
  try {
    const order = await ProductionOrder.findById(orderRef?._id || orderRef);
    if (!order) return null;
    if (order.closedAllLost) return null; // nothing finished, no cost per piece
    const isScp = order.orderKind === 'SubChildPart';
    const u = isScp ? 0 : unitIndex;
    if (!unitFinished(order, u)) return null;

    let entry = (order.unitCosts || []).find(x => x.unitIndex === u);
    if (!entry) { order.unitCosts.push({ unitIndex: u }); entry = order.unitCosts[order.unitCosts.length - 1]; }
    if (!entry.finishedAt) entry.finishedAt = new Date();
    let prod = productionCostOf(order, u);
    if (!prod.entered) prod = (await legacyPendingCost(order, u)) || prod;
    const { money, waitingFor } = await outsourceMoneyFor({ productionOrder: order, unitIndex: isScp ? null : u, live });
    entry.jobWorkCost = money;
    entry.waitingFor = waitingFor;

    const from = { orderId: order.orderId, unitIndex: u, finishedAt: entry.finishedAt, waiting: waitingFor.length > 0 };
    const companyId = order.company;
    let wrote = false;
    if (isScp) {
      const item = await Item.findOne({ _id: order.subChildPartItem, companyId });
      if (item && mayReplace(item.subChildPartDetails?.costFrom, entry.finishedAt, from.waiting)) {
        const qty = await scpFinishedQty(order);
        entry.finishedQty = qty;
        const d = item.subChildPartDetails;
        const source = d.sourceItem ? await Item.findById(d.sourceItem) : null;
        if (source) {
          const { computeSourceMetrics } = await import('../controllers/subChildPartMasterController.js');
          const { materialsCost } = await computeSourceMetrics(source, d.sourceQty, d.sourceUnit, d.sourceDimensionVariantId);
          if (materialsCost > 0) d.materialsCost = materialsCost;
        }
        Object.assign(d, {
          jobWorkCost: round2(money / qty), jobWorkCostSource: 'Actual', jobWorkCostUpdatedAt: new Date(),
          productionCost: round2(prod.cost / qty), productionExpense: round2(prod.expense / qty),
          productionCostSource: 'Actual', productionCostUpdatedAt: new Date(), costFrom: from,
        });
        item.markModified('subChildPartDetails');
        await item.save();
        wrote = true;
      }
    } else {
      const isCp = order.orderKind === 'ChildPart';
      let bom = null;
      let machineItem = null;
      if (isCp) {
        bom = await ChildPartBOM.findOne({ childPart: order.subChildPartItem, company: companyId });
      } else {
        machineItem = await Item.findOne({ $or: [{ code: order.machineCode }, { name: order.machineName }], companyId, productKind: { $in: ['Machine', 'Motor'] } });
        if (machineItem) {
          const key = machineItem.productKind === 'Machine' ? 'machineDetails' : 'motorDetails';
          if (!machineItem[key]?.firstBuiltAt) {
            machineItem[key] = machineItem[key] || {};
            machineItem[key].firstBuiltAt = new Date();
            await machineItem.save();
          }
          // Same gate as before slice 4 (applyManufacturedFinalCost).
          if (machineItem.internalManufacturing) bom = await MachineBOM.findOne({ machine: machineItem._id, company: companyId });
        }
      }
      if (bom && mayReplace(bom.costFrom, entry.finishedAt, from.waiting)) {
        Object.assign(bom, {
          productionCost: round2(prod.cost), productionExpense: round2(prod.expense),
          productionCostSource: 'Actual', productionCostUpdatedAt: new Date(),
          jobWorkCost: money, jobWorkCostSource: 'Actual', jobWorkCostUpdatedAt: new Date(),
          jobWorkWaitingFor: waitingFor, costFrom: from,
        });
        await refreshBomMaterialLines(bom, companyId);
        await bom.save();
        wrote = true;
      }
    }
    entry.pushedAt = new Date();
    await ProductionOrder.updateOne({ _id: order._id }, { $set: { unitCosts: order.unitCosts } });

    if (wrote) {
      const cascade = await import('./priceCascadeService.js');
      if (isScp) await cascade.onSubChildPartChanged(order.subChildPartItem, companyId);
      else if (order.orderKind === 'ChildPart') await cascade.onChildPartChanged(order.subChildPartItem, companyId);
      else {
        const m = await Item.findOne({ $or: [{ code: order.machineCode }, { name: order.machineName }], companyId, productKind: { $in: ['Machine', 'Motor'] } }).select('_id').lean();
        if (m) await cascade.onMachineChanged(m._id, companyId);
      }
    }
    return { money, waitingFor, production: prod, wrote };
  } catch (e) {
    console.error('[PartCost] push failed:', e.message);
    return null;
  }
}

// A fully outsourced Sub Child Part (job-work order), once Completed → its
// per-piece job-work cost = the accepted money ÷ the pieces that went into
// stock. Re-reads the order.
export async function pushJobWorkCost(jobWorkOrderRef, { live = null } = {}) {
  try {
    const jw = await SubChildPartJobWorkOrder.findById(jobWorkOrderRef?._id || jobWorkOrderRef);
    if (!jw || jw.status !== 'Completed' || jw.closedAllLost) return null;
    const { money, waitingFor } = await outsourceMoneyFor({ jobWorkOrder: jw, live });
    const qty = Number(jw.qc?.approvedQty) > 0 ? Number(jw.qc.approvedQty) : Math.max(1, Number(jw.orderQuantity) || 1);
    const finishedAt = jw.completedAt || new Date();
    const item = await Item.findOne({ _id: jw.subChildPartItem, companyId: jw.company });
    let wrote = false;
    if (item && mayReplace(item.subChildPartDetails?.costFrom, finishedAt, waitingFor.length > 0)) {
      const d = item.subChildPartDetails;
      const source = d.sourceItem ? await Item.findById(d.sourceItem) : null;
      if (source) {
        const { computeSourceMetrics } = await import('../controllers/subChildPartMasterController.js');
        const { materialsCost } = await computeSourceMetrics(source, d.sourceQty, d.sourceUnit, d.sourceDimensionVariantId);
        if (materialsCost > 0) d.materialsCost = materialsCost;
      }
      Object.assign(d, {
        jobWorkCost: round2(money / qty), jobWorkCostSource: 'Actual', jobWorkCostUpdatedAt: new Date(),
        productionCost: 0, productionExpense: 0, productionCostSource: 'Actual', productionCostUpdatedAt: new Date(),
        costFrom: { orderId: jw.orderId, unitIndex: 0, finishedAt, waiting: waitingFor.length > 0 },
      });
      item.markModified('subChildPartDetails');
      await item.save();
      wrote = true;
    }
    await SubChildPartJobWorkOrder.updateOne({ _id: jw._id }, { $set: { jobWorkCostTotal: money, costPushedAt: new Date(), costWaitingFor: waitingFor } });
    if (wrote) {
      const { onSubChildPartChanged } = await import('./priceCascadeService.js');
      await onSubChildPartChanged(jw.subChildPartItem, jw.company);
    }
    return { money, waitingFor, qty, wrote };
  } catch (e) {
    console.error('[PartCost] job-work push failed:', e.message);
    return null;
  }
}

// After an Outsource Order's acceptance changed (a receive, a QC pass, a late
// time entry): every finished build it touches pushes again. The order may
// still be unsaved — it's passed through as `live`.
export async function refreshCostsAfterAcceptance(outsourceOrder) {
  try {
    const pos = new Map(); const jws = new Set();
    for (const l of outsourceOrder.lines || []) for (const r of l.requests || []) {
      if (r.kind === 'jobWork' && r.jobWorkOrder) jws.add(String(r.jobWorkOrder));
      if (r.kind === 'handoff' && r.productionOrder) pos.set(String(r.productionOrder), r.handoffId);
    }
    for (const id of jws) await pushJobWorkCost(id, { live: outsourceOrder });
    for (const id of pos.keys()) {
      const po = await ProductionOrder.findById(id).select('orderKind processes extraUnits orderQuantity').lean();
      if (!po) continue;
      const units = po.orderKind === 'SubChildPart' ? [0] : Array.from({ length: Math.max(1, Number(po.orderQuantity) || 1) }, (_, i) => i);
      for (const u of units) if (unitFinished(po, u)) await pushPartCost(id, u, { live: outsourceOrder });
    }
  } catch (e) {
    console.error('[PartCost] refresh after acceptance failed:', e.message);
  }
}
