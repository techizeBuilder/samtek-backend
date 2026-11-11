// Is the material Store has to hand over for outsource work in stock yet?
// (2026-10-23 — a Child Part's first step is now requested automatically,
// often before its Sub Child Parts are made.)
//   - Purchase: a warning on the request and a "order anyway" tick when
//     ordering (they may still book the vendor early).
//   - Dispatch: a line can't go on a trip until Store has it all (no vehicle
//     or freight booked for nothing).
// Works on material-plan rows (outsourceMaterialPlanService): the Store part
// (storeShortfall), and a part Production is still waiting for from a cascade
// order (cascadeShortfall); the pieces / units themselves ('wip') are already
// there. Stock is what's in Store right now — not net of other open trips.
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { heldByProduction } from './stepMaterialService.js';
import { outsourceMaterialOnOrder } from './outsourceEarmarkService.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const fmt = (n) => r3(n).toLocaleString('en-IN');
const OPEN_JOB_WORK = ['Pending', 'In Progress', 'Pending QC'];

const capacityOf = (kind, v) => (kind === 'sheetArea'
  ? (Number(v?.values?.width) || 0) * (Number(v?.values?.length) || 0)
  : (Number(v?.values?.length) || 0));
const sameThickness = (a, b) => Number(a?.thickness ?? a?.thicknessT) === Number(b?.thickness ?? b?.thicknessT);

// The orders to name for a part that's short: the one built for this order when
// there is one, otherwise those filling free stock. An order built for another
// parent goes to that parent, so it's never named here.
async function ordersMakingPart(companyId, item, holders) {
  const parents = holders.length ? await ProductionOrder.find({ _id: { $in: holders }, company: companyId }).select('cascadeCovers').lean() : [];
  const built = parents.flatMap(p => p.cascadeCovers || [])
    .filter(c => String(c.partItem) === String(item._id) && r3(c.qty) > r3(c.delivered))
    .flatMap(c => (c.orders || []).map(o => o.orderNo).filter(Boolean));
  if (built.length) return [...new Set(built)];
  const free = { company: companyId, subChildPartItem: item._id, deliverToParent: { $ne: true } };
  const [pos, jws] = await Promise.all([
    ProductionOrder.find({ ...free, status: { $ne: 'Completed' } }).select('orderId').lean(),
    item.productKind === 'SubChildPart' ? SubChildPartJobWorkOrder.find({ ...free, status: { $in: OPEN_JOB_WORK } }).select('orderId').lean() : [],
  ]);
  return [...pos, ...jws].map(o => o.orderId);
}

// Rows → what's short: [{ itemId, itemName, kind, need, have, unit, text, makingOn: ['ORD-…'] }].
// holders: the orders these rows are for.
export async function storeShortfall(companyId, rows, holders = []) {
  const need = new Map();
  for (const row of rows || []) {
    if (!row || row.kind === 'wip' || !(Number(row.fromStore) > 0) || !row.itemId) continue;
    const kind = row.kind === 'cutPieces' ? 'length' : row.kind;
    const amount = row.kind === 'cutPieces' ? Number(row.fromStore) * (Number(row.pieceSize) || 0) : Number(row.fromStore);
    const k = `${row.itemId}|${kind}|${kind === 'sheetArea' || kind === 'length' ? row.variantId : ''}`;
    const cur = need.get(k) || { itemId: row.itemId, itemName: row.itemName, kind, variantId: row.variantId, unit: row.unit, need: 0 };
    cur.need += amount;
    need.set(k, cur);
  }
  const short = [];
  for (const n of need.values()) {
    const item = await Item.findOne({ _id: n.itemId, companyId }).select('name qty unit productKind dimensionVariants').lean();
    let have = 0;
    if (n.kind === 'sheetArea' || n.kind === 'length') {
      const catalog = (item?.dimensionVariants || []).find(v => String(v._id) === String(n.variantId));
      for (const v of item?.dimensionVariants || []) {
        if (!(v.subStock > 0)) continue;
        if (String(v._id) === String(n.variantId) || (v.isLeftover && catalog && sameThickness(v.values, catalog.values))) have += v.subStock * capacityOf(n.kind, v);
      }
    } else {
      have = Number(item?.qty) || 0;
    }
    if (have + 1e-6 >= n.need) continue;
    const name = item?.name || n.itemName;
    const text = n.kind === 'sheetArea' ? `${name} ${fmt(have / 1e6)} / ${fmt(n.need / 1e6)} m²`
      : n.kind === 'length' ? `${name} ${fmt(have / 1000)} / ${fmt(n.need / 1000)} m`
      : `${name} ${fmt(have)} / ${fmt(n.need)}`;
    const makingOn = ['SubChildPart', 'ChildPart'].includes(item?.productKind) ? await ordersMakingPart(companyId, item, holders) : [];
    short.push({ itemId: n.itemId, itemName: name, kind: n.kind, need: r3(n.need), have: r3(have), text: `${text}${makingOn.length ? ` (being made, ${makingOn.join(', ')})` : ' (short)'}`, makingOn });
  }
  return short;
}

// Parts built for the order, not delivered yet (2 Nov review): a row's
// awaitingDelivery isn't covered until Production holds enough for this
// request's rows plus what other trips already firmly set aside.
// requests: { status, productionOrder, materialPlan }. orderId: the Outsource
// Order these requests are on, left out of "other trips".
export async function cascadeShortfall(companyId, requests, { orderId = null } = {}) {
  const lines = new Map();
  for (const r of requests || []) {
    if (r.status === 'Released' || !r.productionOrder) continue;
    for (const row of r.materialPlan || []) {
      if (!row.demandKey) continue;
      const k = `${r.productionOrder}|${row.demandKey}`;
      const e = lines.get(k) || { productionOrder: r.productionOrder, demandKey: row.demandKey, itemId: row.itemId, itemName: row.itemName, kind: row.kind, unit: row.unit, own: 0, awaiting: 0, orders: [] };
      e.own += Number(row.fromProduction) || 0;
      e.awaiting += Number(row.awaitingDelivery) || 0;
      for (const no of row.awaitingOrders || []) if (!e.orders.includes(no)) e.orders.push(no);
      lines.set(k, e);
    }
  }
  const short = [];
  for (const e of lines.values()) {
    if (!(e.awaiting > 0)) continue;
    const order = await ProductionOrder.findOne({ _id: e.productionOrder, company: companyId }).select('materialDemands').lean();
    const held = heldByProduction((order?.materialDemands || []).find(d => d.materialCode === e.demandKey));
    const others = (await outsourceMaterialOnOrder(e.productionOrder, { excludeOrderId: orderId })).get(e.demandKey);
    const have = Math.max(0, held - Math.max(0, (others?.productionHeld || 0) - (others?.productionAwaiting || 0)));
    if (have + 1e-6 >= e.own) continue;
    short.push({
      itemId: e.itemId, itemName: e.itemName, kind: e.kind, need: r3(e.own), have: r3(have), unit: e.unit, makingOn: e.orders,
      text: `${e.itemName} ${fmt(have)} / ${fmt(e.own)}${e.orders.length ? ` (being made, ${e.orders.join(', ')})` : ''}`,
    });
  }
  return short;
}

// Everything holding a line's requests back from going out.
export async function materialShortfall(companyId, requests, opts = {}) {
  const live = (requests || []).filter(r => r.status !== 'Released');
  const holders = live.map(r => r.productionOrder).filter(Boolean);
  return [...await storeShortfall(companyId, live.flatMap(r => r.materialPlan || []), holders), ...await cascadeShortfall(companyId, live, opts)];
}

// One sentence for a list of shortfalls.
export const shortText = (short) => (short?.length ? `Material not ready: ${short.map(s => s.text).join(' · ')}` : '');
