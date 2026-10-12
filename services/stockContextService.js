// Stock context for an RFQ/PO item card (procurement-v2 gap 9, 2026-10-09):
//   Stock · Still to issue (reserved) · Free · Incoming · Min stock
// for one item — or one fabrication SIZE (a card is one size since
// 2026-10-09) — plus the details behind them for the card's pop-up:
// which orders reserved it, which order each purchase request is for, and
// the open POs bringing it in.
//
// Units: stock / reserved / free / min are in the item's STOCK unit (pieces
// for a fabrication size); incoming is in the PO's own purchase unit (often
// kg) — shown as is, never converted (user decision).
import mongoose from 'mongoose';
import MaterialReservation from '../models/MaterialReservation.js';
import Purchase from '../models/Purchase.js';
import { dimensionSignature } from './fabricationDemandService.js';
import { getFreeQty, remainingOf } from './materialReservationService.js';

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const OPEN_PO_STATUSES = ['Draft', 'Sent', 'Acknowledged', 'Partially Received'];
const KIND_LABEL = { Machine: 'Machine', ChildPart: 'Child Part', SubChildPart: 'Sub Child Part' };

// The catalog size of `item` matching a card's sizeKey (dimensionSignature).
export function catalogVariantFor(item, sizeKey) {
  if (!sizeKey) return null;
  return (item?.dimensionVariants || []).find(v => !v.isLeftover && dimensionSignature(v.values) === sizeKey) || null;
}

// Incoming from open POs: lines for this item (and size), counted until their
// requests are received. A line whose requests are partly received counts in
// proportion. Pure — exported for tests.
export function incomingFromPurchases(purchases, itemId, sizeKey = '') {
  const lines = [];
  for (const po of purchases || []) {
    for (const line of po.items || []) {
      if (!line.item || String(line.item._id || line.item) !== String(itemId)) continue;
      if (line.cancelled?.at) continue; // short-closed line (gap 13) — not coming
      const fab = line.fabricationDimensionLines || [];
      if (sizeKey) {
        // A size card: only lines of that size (older multi-size lines: their matching size's pieces).
        const ofSize = fab.filter(l => dimensionSignature(l.values) === sizeKey);
        if (fab.length && !ofSize.length) continue;
      }
      const prs = (line.purchaseRequests?.length ? line.purchaseRequests : (line.purchaseRequest ? [line.purchaseRequest] : [])).filter(Boolean);
      const total = prs.length;
      const received = prs.filter(pr => pr?.status === 'Received').length;
      const openShare = total ? (total - received) / total : 1;
      if (openShare <= 0) continue;
      const pieces = sizeKey ? fab.filter(l => dimensionSignature(l.values) === sizeKey).reduce((s, l) => s + (Number(l.quantity) || 0), 0) : 0;
      lines.push({
        purchaseId: po._id,
        poNumber: po.purchaseOrderNumber,
        vendorName: po.supplier?.supplierName || '',
        status: po.status,
        expected: line.expectedDeliveryDate || po.expectedDeliveryDate || null,
        quantity: round3((Number(line.quantity) || 0) * openShare),
        unit: line.purchaseUnit || '',
        pieces: pieces ? Math.round(pieces * openShare) : null,
      });
    }
  }
  // Summed per unit (pieces for a size card).
  const byUnit = new Map();
  for (const l of lines) {
    const u = sizeKey && l.pieces != null ? 'pcs' : (l.unit || '');
    const q = sizeKey && l.pieces != null ? l.pieces : l.quantity;
    byUnit.set(u, round3((byUnit.get(u) || 0) + q));
  }
  return { lines, totals: [...byUnit.entries()].map(([unit, quantity]) => ({ unit, quantity })) };
}

async function openPurchasesFor(companyId, itemIds) {
  return Purchase.find({ companyId, status: { $in: OPEN_PO_STATUSES }, 'items.item': { $in: itemIds } })
    .select('purchaseOrderNumber status supplier expectedDeliveryDate items')
    .populate('supplier', 'supplierName')
    .populate('items.purchaseRequest', 'status')
    .populate('items.purchaseRequests', 'status')
    .lean();
}

// The summary numbers for one item / size.
async function summaryFor({ companyId, item, sizeKey, purchases }) {
  const variant = catalogVariantFor(item, sizeKey);
  const isSize = !!sizeKey;
  const stock = isSize ? (variant?.subStock || 0) : (item.qty || 0);
  const free = await getFreeQty(item._id, stock, companyId, { variantId: variant?._id || null });
  const minStock = isSize ? (variant?.minStock || 0) : (item.minStock || 0);
  const incoming = incomingFromPurchases(purchases, item._id, sizeKey);
  return {
    unit: isSize ? 'pcs' : (item.unit || ''),
    stock: round3(stock),
    reserved: round3(stock - free), // still to issue to orders
    free: round3(free),
    minStock,
    belowMin: minStock > 0 && free <= minStock,
    short: free < 0,
    incoming: incoming.totals,
    sizeFound: isSize ? !!variant : true,
    variantId: variant?._id || null,
  };
}

// For the board: one summary per Open group, in one pass.
export async function stockSummariesForGroups(companyId, groups) {
  const Item = mongoose.models.Item;
  const itemIds = [...new Set(groups.map(g => String(g.item?._id || g.item)).filter(Boolean))];
  if (!itemIds.length) return new Map();
  const items = await Item.find({ _id: { $in: itemIds } }).select('qty unit minStock dimensionVariants').lean();
  const itemById = new Map(items.map(i => [String(i._id), i]));
  const purchases = await openPurchasesFor(companyId, itemIds);
  const out = new Map();
  for (const g of groups) {
    const item = itemById.get(String(g.item?._id || g.item));
    if (!item) continue;
    out.set(String(g._id), await summaryFor({ companyId, item, sizeKey: g.sizeKey || '', purchases }));
  }
  return out;
}

// The pop-up: summary + reserving orders + which order each request is for + open POs.
export async function stockDetailForGroup(companyId, group) {
  const Item = mongoose.models.Item;
  const item = await Item.findById(group.item?._id || group.item).select('name code qty unit minStock dimensionVariants').lean();
  if (!item) return null;
  const sizeKey = group.sizeKey || '';
  const purchases = await openPurchasesFor(companyId, [item._id]);
  const summary = await summaryFor({ companyId, item, sizeKey, purchases });

  // Reserving orders (earliest claim first).
  const rows = await MaterialReservation.find({ item: item._id, company: companyId, dimensionVariantId: summary.variantId || null })
    .sort({ createdAt: 1 }).lean();
  const ProductionOrder = mongoose.models.ProductionOrder;
  const JobWork = mongoose.models.SubChildPartJobWorkOrder;
  const SalesOrder = mongoose.models.Order;
  const ids = (model) => rows.filter(r => r.reservedByOrderModel === model).map(r => r.reservedByOrderId);
  const prodById = new Map(ProductionOrder ? (await ProductionOrder.find({ _id: { $in: ids('ProductionOrder') } }).select('orderId orderKind machineName status orderCode').lean()).map(o => [String(o._id), o]) : []);
  const jwById = new Map(JobWork ? (await JobWork.find({ _id: { $in: ids('SubChildPartJobWorkOrder') } }).select('orderId status').lean()).map(o => [String(o._id), o]) : []);
  const reservations = rows.map(r => {
    const p = prodById.get(String(r.reservedByOrderId));
    const j = jwById.get(String(r.reservedByOrderId));
    return {
      orderCode: p?.orderId || j?.orderId || '(order not found)',
      kind: p ? (KIND_LABEL[p.orderKind] || 'Production') : 'Job work',
      forWhat: p?.machineName || '',
      salesOrder: p?.orderCode || '',
      status: p?.status || j?.status || '',
      reserved: r.quantity, issued: r.issuedQuantity || 0, remaining: remainingOf(r), reservedAt: r.createdAt,
    };
  });

  // Which order each selected request is for.
  const prs = (group.purchaseRequests || []).filter(pr => pr && typeof pr === 'object');
  const orderIds = [...new Set(prs.map(pr => pr.storeOrderId).filter(Boolean).map(String))];
  const prodOrders = new Map(ProductionOrder && orderIds.length ? (await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderId orderKind machineName orderCode').lean()).map(o => [String(o._id), o]) : []);
  const salesOrders = new Map(SalesOrder && orderIds.length ? (await SalesOrder.find({ _id: { $in: orderIds } }).select('orderCode').lean()).map(o => [String(o._id), o]) : []);
  const requests = prs.map(pr => {
    const p = pr.storeOrderId ? prodOrders.get(String(pr.storeOrderId)) : null;
    const s = pr.storeOrderId ? salesOrders.get(String(pr.storeOrderId)) : null;
    let forText = 'Raised by hand';
    if (p) forText = `${KIND_LABEL[p.orderKind] || 'Production'} order ${p.orderId}${p.machineName ? ` (${p.machineName})` : ''}${p.orderCode ? ` · sales ${p.orderCode}` : ''}`;
    else if (s) forText = `Sales order ${s.orderCode}`;
    else if (pr.reorderItemId) forText = 'Low-stock reorder (minimum stock)';
    return {
      requestId: pr.requestId,
      quantity: pr.quantity,
      unit: pr.unit || '',
      pieces: (pr.fabricationDimensionLines || []).reduce((s2, l) => s2 + (Number(l.quantity) || 0), 0) || null,
      priority: pr.priority,
      forText,
    };
  });

  return {
    item: { name: item.name, code: item.code },
    size: catalogVariantFor(item, sizeKey)?.values || null,
    summary,
    reservations,
    requests,
    incoming: incomingFromPurchases(purchases, item._id, sizeKey).lines,
  };
}
