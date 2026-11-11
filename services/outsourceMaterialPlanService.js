// The outsource material plan (outsource-v2 slice 5, 2026-10-20 —
// docs/outsource-v2/material-logic-2026-10.md, slice-5-material-plan.md).
//
// When Purchase makes an Outsource Order (M1), each request gets a plan: for
// every material line of the steps its trip covers, how much comes from
// PRODUCTION (what Production holds for that order — received, or on its way
// from Store, M4 — less what other trips already set aside) and how much from
// STORE (the rest). Sheet / length material from Store on one line is
// combined into whole sheets / lengths and shared out by area / length (M2).
// Production can't request the Store part any more; an open request of its
// own beyond that is trimmed back.
//
// Always worked out per request, from that request's own units / pieces and
// its own order's steps — never across requests (workflow §4.4).
import { Item } from '../models/Inventory.js';
import SubChildPartSheetPlan from '../models/SubChildPartSheetPlan.js';
import { computeSubChildPartRawMaterialAvailability } from './subChildPartOrderService.js';
import { computeSubChildPartMaterialRows } from './childPartReorderService.js';
import { computeMachineMaterialRows } from './machineReorderService.js';
import { bomLinesForOrder, stepMaterialPerUnit, heldByProduction } from './stepMaterialService.js';
import { outsourceMaterialOnOrder, rowDemandUnits, issueLimit } from './outsourceEarmarkService.js';
import { cascadeOnRow } from './cascadeDeliveryService.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const GONE_OUT = ['Sent', 'Received'];
const unitProcs = (order, unitIndex) => (unitIndex ? order.extraUnits?.[unitIndex - 1]?.processes || order.processes : order.processes);

// The pieces / units themselves (work in progress), carried to the vendor.
const wipRow = (name, qty, unit, from) => ({
  kind: 'wip', demandKey: null, itemName: name, unit, need: qty, qty,
  fromProduction: from === 'production' ? qty : 0, fromStore: from === 'store' ? qty : 0,
});

// Slice 7 (R2) — how many of these units' work is waiting at Store (returned
// from an earlier trip, not yet handed to Production). That part of the next
// trip comes straight from Store.
const unitsAtStore = (order, unitIndices) => {
  const held = new Set((order.workAtStore || []).map(w => w.unitIndex));
  return (unitIndices || []).filter(u => held.has(u)).length;
};

// A Sub Child Part's raw material has already left Store on an earlier trip
// (a rework resend carries the reworked pieces, not fresh material).
function scpMaterialSent(order, roundId) {
  return (order.outsourceHandoffs || []).some(h => h.isFirstStepOfOrder
    && (h.rounds || []).some(x => String(x._id) !== String(roundId) && GONE_OUT.includes(x.status)));
}

// A Sub Child Part's one source material for `pcs` pieces — always from Store.
// `withKey`: the production order's Material List key (a hybrid order); a
// job-work order has no Material List.
async function scpSourceRows(itemId, pcs, withKey, companyId) {
  const item = await Item.findOne({ _id: itemId, companyId }).lean();
  const sourceId = item?.subChildPartDetails?.sourceItem;
  const sourceItem = sourceId ? await Item.findOne({ _id: sourceId, companyId }).lean() : null;
  if (!item || !sourceItem) return [];
  const c = await computeSubChildPartRawMaterialAvailability(item, sourceItem, pcs);
  const base = {
    demandKey: withKey ? (c.demandSeed?.materialCode || null) : null,
    itemId: sourceItem._id, itemCode: sourceItem.code, itemName: sourceItem.name, qty: pcs, fromProduction: 0,
  };
  if (c.kind === 'plain' && c.neededQty != null) {
    return [{ ...base, kind: 'plain', unit: sourceItem.unit || '', need: r3(c.neededQty), fromStore: r3(c.neededQty) }];
  }
  if (c.kind === 'sheet' && c.catalogSheet?.areaMm2 && c.totalAreaNeededMm2 > 0) {
    const plan = await SubChildPartSheetPlan.findOne({ subChildPart: item._id, company: companyId }).select('sheetsUsed orderQty').lean();
    const ratio = plan?.sheetsUsed > 0 && plan?.orderQty > 0 ? plan.sheetsUsed / plan.orderQty : null;
    return [{
      ...base, kind: 'sheetArea', unit: 'mm²', variantId: String(c.sourceDimensionVariantId),
      need: r3(c.totalAreaNeededMm2), fromStore: r3(c.totalAreaNeededMm2), pieceSize: c.catalogSheet.areaMm2, planSheetsPerPc: ratio,
    }];
  }
  if (c.kind === 'length' && c.catalogPieceLengthMm > 0 && c.totalLengthNeededMm > 0) {
    return [{
      ...base, kind: 'length', unit: 'mm', variantId: String(c.sourceDimensionVariantId),
      need: r3(c.totalLengthNeededMm), fromStore: r3(c.totalLengthNeededMm), pieceSize: c.catalogPieceLengthMm,
    }];
  }
  return [];
}

async function externalFor(ctx, order, productionOrderId) {
  const k = String(productionOrderId);
  if (!ctx.external.has(k)) ctx.external.set(k, await outsourceMaterialOnOrder(productionOrderId, { excludeOrderId: order._id }));
  return ctx.external.get(k);
}

// One request's plan rows.
async function buildRequestPlan(order, records, r, ctx) {
  const { doc, handoff } = await records.handoffOf(r);
  const qty = Number(r.qty) || 0;

  if (r.kind === 'jobWork') {
    const sentBefore = !!doc.rawMaterial?.sentAt
      || (doc.rounds || []).some(x => String(x._id) !== String(r.roundId) && GONE_OUT.includes(x.status));
    // Between trips a job-work order's pieces wait at Store (Production never
    // sees it).
    return sentBefore ? [wipRow(doc.itemName, qty, 'pcs', 'store')] : scpSourceRows(doc.subChildPartItem, qty, false, ctx.companyId);
  }

  if (doc.orderKind === 'SubChildPart') {
    const takesRaw = (r.stepIndices || []).includes(0) && !scpMaterialSent(doc, r.roundId);
    if (takesRaw) return scpSourceRows(doc.subChildPartItem, qty, true, ctx.companyId);
    return [wipRow(doc.machineName, qty, 'pcs', unitsAtStore(doc, [0]) ? 'store' : 'production')];
  }

  // Child Part / Machine — the step(s) this trip covers, × this request's units.
  const units = (handoff.unitIndices || []).length || qty;
  const procs = unitProcs(doc, (handoff.unitIndices || [0])[0]);
  const found = await bomLinesForOrder(doc, ctx.companyId);
  const merged = new Map();
  let sendsAssembly = false;
  // Only the run's FIRST step decides whether the part itself goes: a later
  // step in the same run works on what the vendor just made (2026-10-23 —
  // Fan welding (own materials) › grinding (assembled part) asked Production
  // for a Fan that didn't exist yet). Every step's own materials still go.
  const firstIdx = Math.min(...(r.stepIndices || []));
  for (const idx of r.stepIndices || []) {
    const proc = procs?.[idx];
    if (!proc) continue;
    if (idx === firstIdx && proc.materialSource === 'AssembledPart') sendsAssembly = true;
    for (const row of await stepMaterialPerUnit(proc, found, ctx.companyId)) {
      const m = merged.get(row.bomLineId);
      if (m) { m.perUnit += row.perUnit; m.perUnitDu += row.perUnitDu; } else merged.set(row.bomLineId, { ...row });
    }
  }

  const rows = [];
  // The units themselves: from Store when their earlier outsourced work is
  // waiting there (R2 — then they go even if this step doesn't say it sends
  // the assembled part, or they'd be stuck at Store), else from Production.
  const atStore = unitsAtStore(doc, handoff.unitIndices);
  if (sendsAssembly || atStore) {
    rows.push({ ...wipRow(doc.machineName, units, 'units', 'production'), fromStore: atStore, fromProduction: sendsAssembly ? units - atStore : 0, need: sendsAssembly ? units : atStore });
  }
  const external = await externalFor(ctx, order, doc._id);
  const demandByKey = new Map((doc.materialDemands || []).map(d => [d.materialCode, d]));
  for (const m of merged.values()) {
    const need = m.perUnit * units;
    const needDu = m.perUnitDu * units;
    const usedKey = `${doc._id}|${m.demandKey}`;
    // Production first: what it holds for this order, less what other trips
    // (other orders, and earlier requests of this one) already set aside.
    const heldNow = heldByProduction(demandByKey.get(m.demandKey))
      - (external.get(m.demandKey)?.productionHeld || 0) - (ctx.used.get(usedKey) || 0);
    // A part built for this order, still being made in-house, lands on
    // Production's floor: planned from Production, and Dispatch waits for it.
    // Through Store (its last step is outsourced) it stays "from Store".
    const cascade = m.kind === 'parts' ? cascadeOnRow(doc, m.demandKey) : null;
    const coming = cascade && !cascade.viaStore ? cascade.left : 0;
    const prodDu = Math.min(needDu, Math.max(0, heldNow + coming));
    const awaiting = r3(Math.max(0, prodDu - Math.max(0, heldNow)));
    ctx.used.set(usedKey, (ctx.used.get(usedKey) || 0) + prodDu);
    const fromProduction = r3(m.perUnitDu ? prodDu * (m.perUnit / m.perUnitDu) : 0);
    rows.push({
      ...(awaiting > 0 ? { awaitingDelivery: awaiting, awaitingOrders: cascade.orders } : {}),
      kind: m.kind, bomLineId: m.bomLineId, demandKey: m.demandKey,
      itemId: m.itemId, itemCode: m.code, itemName: m.name, variantId: m.variantId, unit: m.unit,
      need: r3(need), fromProduction, fromStore: r3(Math.max(0, need - fromProduction)),
      pieceSize: m.pieceSize, qty: units,
    });
  }
  return rows;
}

// M2 — sheet / length material from Store on one line goes as one cutting
// run: whole sheets / lengths for the total, each row booked its share.
export function combineLine(line) {
  const groups = new Map();
  for (const r of line.requests || []) {
    if (r.status === 'Released') continue;
    for (const row of r.materialPlan || []) {
      if (!['sheetArea', 'length'].includes(row.kind) || !(row.fromStore > 0) || !(row.pieceSize > 0)) continue;
      const k = `${row.kind}|${row.itemId}|${row.variantId}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
  }
  const out = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const total = rows.reduce((s, x) => s + x.fromStore, 0);
    // A Sub Child Part's Sheet Plan (R&D's real cutting run) beats the area
    // estimate, when every row on the line is that same part from Store.
    const ratio = first.planSheetsPerPc;
    const usePlan = first.kind === 'sheetArea' && ratio > 0 && rows.every(x => x.planSheetsPerPc === ratio && !(x.fromProduction > 0));
    const pieces = usePlan
      ? Math.ceil(ratio * rows.reduce((s, x) => s + (Number(x.qty) || 0), 0) - 1e-9)
      : Math.ceil(total / first.pieceSize - 1e-9);
    let given = 0;
    rows.forEach((x, i) => {
      x.storeShare = i === rows.length - 1 ? r3(pieces - given) : r3(pieces * x.fromStore / total);
      given = r3(given + x.storeShare);
    });
    out.push({
      kind: first.kind, itemId: first.itemId, itemCode: first.itemCode, itemName: first.itemName, variantId: first.variantId,
      total: r3(total), unit: first.unit, pieceSize: first.pieceSize, pieces, method: usePlan ? 'plan' : 'area',
    });
  }
  return out;
}

// Production may no longer request the Store part: an open request of its
// own beyond the new limit (not yet sent by Store) is trimmed back. Returns
// what was trimmed, for the order's history.
async function trimProductionRequests(doc, order, companyId) {
  if (doc.orderKind === 'SubChildPart') return []; // its Issue is already blocked
  const storeByKey = new Map();
  const add = (key, n) => { if (key && n > 0) storeByKey.set(key, (storeByKey.get(key) || 0) + n); };
  for (const [key, e] of await outsourceMaterialOnOrder(doc._id, { excludeOrderId: order._id })) add(key, e.store);
  for (const l of order.lines) {
    for (const r of l.requests) {
      if (r.status === 'Released' || String(r.productionOrder) !== String(doc._id)) continue;
      for (const row of r.materialPlan || []) add(row.demandKey, rowDemandUnits(row).store);
    }
  }
  if (!storeByKey.size || !(doc.materialDemands || []).some(d => storeByKey.has(d.materialCode))) return [];

  const { rows } = doc.orderKind === 'ChildPart'
    ? await computeSubChildPartMaterialRows(doc, companyId)
    : await computeMachineMaterialRows(doc, companyId);
  const trimmed = [];
  for (const d of [...doc.materialDemands]) {
    const store = storeByKey.get(d.materialCode);
    if (!store) continue;
    const row = rows.find(x => x.demandKey === d.materialCode);
    if (!row) continue;
    const limit = issueLimit(row.issueTotal, store, row.issueUnit);
    const sent = Number(d.transferredQuantity) || 0;
    if (!((d.quantity || 0) > limit) || !((d.quantity || 0) > sent)) continue;
    const was = d.quantity;
    const keep = Math.max(sent, limit);
    if (keep <= 0) {
      doc.materialDemands.pull(d._id);
    } else {
      d.quantity = keep;
      if (keep <= (Number(d.issuedQuantity) || 0)) d.status = 'Issued';
      else if (keep <= sent) d.status = 'In Transit';
    }
    trimmed.push(`${doc.orderId}: ${d.materialName} request ${was} → ${keep} ${row.issueUnit}`);
  }
  return trimmed;
}

// What a request WOULD take from Store if every step left were ordered now
// (2026-10-23 — the "material not ready" warning before ordering). A dry run:
// nothing is saved; no other order is excluded.
export async function previewRequestStoreRows(companyId, records, ref, view) {
  const r = ref.kind === 'jobWork'
    ? { kind: 'jobWork', jobWorkOrder: ref.jobWorkOrder, qty: view.qty, roundId: null }
    : { kind: 'handoff', productionOrder: ref.productionOrder, handoffId: ref.handoffId, qty: view.qty, roundId: null,
      stepIndices: (view.stepsLeft || []).map(s => view.stepIndices?.[(view.steps || []).indexOf(s)]).filter(i => i != null) };
  const rows = await buildRequestPlan({ _id: null }, records, r, { companyId, used: new Map(), external: new Map() });
  return rows.filter(x => x.kind !== 'wip' && (Number(x.fromStore) > 0 || Number(x.awaitingDelivery) > 0));
}

// Builds every live request's plan and each line's combined material; trims
// Production's open requests. The records are saved by the caller
// (RecordSet.saveAll), the order too. Returns { trimmed }.
export async function buildOrderPlans(order, records, companyId) {
  const ctx = { companyId, used: new Map(), external: new Map() };
  const productionRefs = new Map();
  for (const line of order.lines) {
    for (const r of line.requests) {
      if (r.status === 'Released') continue;
      r.materialPlan = await buildRequestPlan(order, records, r, ctx);
      if (r.kind === 'handoff') productionRefs.set(String(r.productionOrder), r);
    }
    line.combinedMaterial = combineLine(line);
  }
  const trimmed = [];
  for (const r of productionRefs.values()) {
    const { doc } = await records.handoffOf(r);
    trimmed.push(...await trimProductionRequests(doc, order, companyId));
  }
  return { trimmed };
}
