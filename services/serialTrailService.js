// Serial tracking into production and to the customer (serial number work
// step 2, 2026-10-31 — docs/serial number work/serial-tracking-logic-2026-10.md).
//
// One place for every move of a tracked thing:
//   - a purchased unit with its own vendor serial (PurchasedUnit, not a lot)
//   - a stickered made part (PartLabel, §5.4)
// Each move sets the record's current `place` and adds a `trail` event — never
// overwritten, so a return and a re-issue both stay visible.
import mongoose from 'mongoose';
import PurchasedUnit from '../models/PurchasedUnit.js';
import PartLabel from '../models/PartLabel.js';
import SerialSkipLog from '../models/SerialSkipLog.js';
import { isCountableUnit } from './purchasedUnitService.js';

const oid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(x => String(x?._id || x)).filter(x => /^[a-f0-9]{24}$/i.test(x)))];

// ── Pure ──────────────────────────────────────────────────────────────────

// How many tracked things Store / QC must pick when handing over `qty`.
// tracked = tracked ones in stock; untracked = the rest of the stock (older
// receipts, no-warranty receipts) — those can go without a pick.
export function pickRule({ qty, tracked, untracked }) {
  const q = Math.max(0, Math.round(Number(qty) || 0));
  const t = Math.max(0, Number(tracked) || 0);
  const u = Math.max(0, Number(untracked) || 0);
  return { qty: q, min: Math.max(0, Math.min(q, t, q - u)), max: Math.min(q, t), untracked: u };
}

// The message when a pick doesn't fit the rule (null = fine).
export function pickProblem(picked, rule, noun = 'serial number', of = "of what you're handing over") {
  const s = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (picked < rule.min) {
    return rule.min === rule.qty
      ? `Pick the ${s(rule.min)} ${of} (${picked} picked).`
      : `Pick at least ${s(rule.min)}: only ${rule.untracked} piece${rule.untracked === 1 ? '' : 's'} in stock ha${rule.untracked === 1 ? 's' : 've'} no serial (${picked} picked).`;
  }
  if (picked > rule.max) return `You picked ${picked}, but only ${rule.max} can go in this handover.`;
  return null;
}

// Fewer serials picked than pieces, while more could be picked (logic §12): the
// warning, or null. Below rule.min is pickProblem's hard block.
export function noSerialCheck({ itemId = null, name, picked, rule, tracked }) {
  if (!(picked < rule.max)) return null;
  const without = rule.qty - picked;
  const text = `${name}: ${without} piece${without === 1 ? '' : 's'} going without a serial number. ${tracked} ha${tracked === 1 ? 's' : 've'} a serial number. If ${without === 1 ? 'this piece has' : 'these pieces have'} one, go back and pick it.`;
  return { text, itemId, name, qty: rule.qty, picked };
}
// A multipart form sends the flag as text.
export const acknowledged = (v) => v === true || v === 'true';
// The 409 a screen answers with: it shows these, then sends acknowledgeWarnings.
export const confirmBody = (list) => {
  const confirmWarnings = list.map(x => x.text || x);
  return { success: false, message: confirmWarnings.join(' '), data: { confirmWarnings } };
};

// Pieces of stock with no serial: not picked, and not waiting for a sticker.
export const untrackedCount = (stock, trackedCount, unlabelled = 0) =>
  Math.max(0, (Number(stock) || 0) - (Number(trackedCount) || 0) - (Number(unlabelled) || 0));

// Parts waiting for a sticker block a handover only when it needs them (2 Nov
// review). The message, or null when the rest of the stock covers it.
export function unlabelledProblem({ qty, stock, unlabelled, name = 'this part' }) {
  const u = Number(unlabelled) || 0;
  if (!(u > 0)) return null;
  const free = Math.max(0, (Number(stock) || 0) - u);
  if ((Number(qty) || 0) <= free + 1e-9) return null;
  return `Only ${free} ${name} can go now: ${u} hold tracked serial numbers and wait for a sticker. Label them on Store → Label carriers first.`;
}

// Does R&D's usage choice apply to this item? (items counted in pieces that
// aren't the sold product itself or a bought part — D4.)
export function needsProductionUse(item) {
  if (!item) return false;
  if (['Machine', 'Motor', 'SubChildPart', 'ChildPart'].includes(item.productKind)) return false;
  return isCountableUnit(item.unit);
}

// Someone went ahead after the warning. A failure here doesn't undo the action.
export async function logSkippedSerials(companyId, skips, { screen, reference = '', by = '' }) {
  const rows = (skips || []).filter(Boolean);
  if (!rows.length) return;
  try {
    await SerialSkipLog.insertMany(rows.map(s => ({ companyId, item: s.itemId, itemName: s.name, screen, qty: s.qty, picked: s.picked, reference, byName: by })));
  } catch (e) { console.error('[SerialSkipLog]', e.message); }
}

// ── Reads ─────────────────────────────────────────────────────────────────

// A unit accepted before tracking started has no place yet — it counts as in
// stock (§10: units still in stock are pickable from day one).
export const IN_STOCK = ['Stock', null];

// What Store can pick for an item: vendor-serial units and stickered parts in
// stock. Units must be Accepted by QC.
export async function stockTracked(companyId, itemId) {
  const [units, labels] = await Promise.all([
    PurchasedUnit.find({ companyId: oid(companyId), item: oid(itemId), isLot: false, status: 'Accepted', 'place.kind': { $in: IN_STOCK } })
      .select('serialNumber vendorName poNumber receivedAt vendorWarrantyMonths').sort({ receivedAt: 1 }).lean(),
    PartLabel.find({ companyId: oid(companyId), item: oid(itemId), status: 'Labelled', 'place.kind': 'Stock' })
      .select('labelNo builtIn labelledAt').sort({ labelledAt: 1 }).lean(),
  ]);
  return { units, labels, count: units.length + labels.length };
}

// Unlabelled carriers of an item still in stock (they can't go out — D13).
export const unlabelledInStock = (companyId, itemId) =>
  PartLabel.countDocuments({ companyId: oid(companyId), item: oid(itemId), status: 'Unlabelled', 'place.kind': 'Stock' });

// ── R&D's daily reminder (D5 / D6) ────────────────────────────────────────

// One bell per company while plain items counted in pieces have no usage type.
export async function runUsageTypeReminder() {
  const { Item } = await import('../models/Inventory.js');
  const { COUNTABLE } = await import('./purchasedUnitService.js');
  const notificationService = (await import('./notificationService.js')).default;
  const groups = await Item.aggregate([
    { $match: { productKind: null, isDiscontinued: { $ne: true }, productionUse: null, unit: { $regex: COUNTABLE }, companyId: { $ne: null } } },
    { $group: { _id: '$companyId', count: { $sum: 1 } } },
  ]);
  for (const g of groups) {
    try { await notificationService.triggerRDNotification({ action: 'needs_usage_type', data: { count: g.count }, targetCompanyId: g._id }); }
    catch (e) { console.error('[SerialTrail] usage reminder failed:', e.message); }
  }
  return { companies: groups.length, items: groups.reduce((s, g) => s + g.count, 0) };
}

// ── Moves ─────────────────────────────────────────────────────────────────

// Checks that every picked id is one of `allowed` (e.g. in stock for this
// item); returns the clean id lists or { error }.
export function checkPicked({ unitIds, labelIds }, allowed) {
  const u = ids(unitIds); const l = ids(labelIds);
  const okU = new Set((allowed.units || []).map(x => String(x._id)));
  const okL = new Set((allowed.labels || []).map(x => String(x._id)));
  if (u.some(x => !okU.has(x)) || l.some(x => !okL.has(x))) return { error: 'A picked serial / sticker isn\'t available here any more — refresh and pick again.' };
  return { unitIds: u, labelIds: l };
}

// Moves units and / or stickered parts: sets their place and adds one trail
// event each. place: { kind, order, orderNo, label, labelNo, customerOrderCode }.
// `from` (optional) guards the move: only records currently at that place kind.
export async function move({ unitIds = [], labelIds = [], place, what, by = '', note = '', from = null }) {
  const set = { place: { kind: place.kind, order: place.order || null, orderNo: place.orderNo || '', label: place.label || null, labelNo: place.labelNo || '', customerOrderCode: place.customerOrderCode || '', defectiveOf: place.defectiveOf || '', ticketNo: place.ticketNo || '', customerMobile: place.customerMobile || '' } };
  const event = { at: new Date(), by, what, order: place.order || null, orderNo: place.orderNo || '', label: place.label || null, labelNo: place.labelNo || '', note };
  const guard = from ? { 'place.kind': { $in: [].concat(from) } } : {};
  const u = ids(unitIds); const l = ids(labelIds);
  const ru = u.length ? await PurchasedUnit.updateMany({ _id: { $in: u.map(oid) }, ...guard }, { $set: set, $push: { trail: event } }) : { modifiedCount: 0 };
  const rl = l.length ? await PartLabel.updateMany({ _id: { $in: l.map(oid) }, ...guard }, { $set: set, $push: { trail: event } }) : { modifiedCount: 0 };
  return (ru.modifiedCount || 0) + (rl.modifiedCount || 0);
}

// ── Stock carriers and stickers (slice C, §5.4) ───────────────────────────

// The order and every cascade order below it that delivers to it (their
// parts — and the serials in them — end up in this order's units).
export async function orderTree(orderId, companyId) {
  const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
  const SubChildPartJobWorkOrder = (await import('../models/SubChildPartJobWorkOrder.js')).default;
  const all = [oid(orderId)];
  let frontier = [oid(orderId)];
  for (let depth = 0; frontier.length && depth < 6; depth++) {
    const q = { company: oid(companyId), demandRefId: { $in: frontier }, deliverToParent: true };
    const [p, j] = await Promise.all([ProductionOrder.find(q).select('_id').lean(), SubChildPartJobWorkOrder.find(q).select('_id').lean()]);
    frontier = [...p, ...j].map(x => x._id);
    all.push(...frontier);
  }
  return all;
}

// A repaired or returned piece in stock, waiting for its sticker: what's inside
// it is known and stays "Issued" until the sticker goes on, but it's in stock
// inside that piece, not with its old order (found 4 Nov: a repaired Mount's
// serial read as gone to the customer of the order its twin was built for).
// Ids of everything held that way. A set of strings.
async function heldInWaitingCarriers(companyId) {
  const rows = await PartLabel.find({ companyId: oid(companyId), status: 'Unlabelled', 'place.kind': 'Stock', $or: [{ 'contains.units.0': { $exists: true } }, { 'contains.labels.0': { $exists: true } }] }).select('contains').lean();
  return new Set(rows.flatMap(r => [...(r.contains?.units || []), ...(r.contains?.labels || [])]).map(String));
}

// What may be inside a finished unit of this order: serials / stickers issued
// to it (or to its cascade orders) and not yet paired into a sticker.
// forLabel: a piece that already knows what it holds offers only that.
export async function carrierCandidates(orderId, companyId, { forLabel = null } = {}) {
  const pickU = 'serialNumber itemName vendorName place'; const pickL = 'labelNo itemName place';
  const knownU = forLabel?.contains?.units || []; const knownL = forLabel?.contains?.labels || [];
  if (knownU.length || knownL.length) {
    const [units, labels] = await Promise.all([
      PurchasedUnit.find({ _id: { $in: knownU }, 'place.kind': 'Issued' }).select(pickU).sort({ itemName: 1, serialKey: 1 }).lean(),
      PartLabel.find({ _id: { $in: knownL }, 'place.kind': 'Issued' }).select(pickL).sort({ itemName: 1, labelKey: 1 }).lean(),
    ]);
    return { units, labels, count: units.length + labels.length };
  }
  const tree = await orderTree(orderId, companyId);
  const [all, allLabels, held] = await Promise.all([
    PurchasedUnit.find({ companyId: oid(companyId), 'place.kind': 'Issued', 'place.order': { $in: tree } }).select(pickU).sort({ itemName: 1, serialKey: 1 }).lean(),
    PartLabel.find({ companyId: oid(companyId), 'place.kind': 'Issued', 'place.order': { $in: tree } }).select(pickL).sort({ itemName: 1, labelKey: 1 }).lean(),
    heldInWaitingCarriers(companyId),
  ]);
  const units = all.filter(x => !held.has(String(x._id))); const labels = allLabels.filter(x => !held.has(String(x._id)));
  return { units, labels, count: units.length + labels.length };
}

// Finished units of an order went into STOCK (§5.4). If they carry tracked
// serials, each gets an Unlabelled sticker entry for Store + a bell. A Sub
// Child Part cut from a fraction of a unit can't carry it per piece: its
// source serials are noted "Cut into batch" and nothing is labelled (D7).
// order: ProductionOrder (Machine / Child Part / Sub Child Part) or a job-work
// order. Never throws.
export async function registerStockCarriers({ order, itemId, qty, by = '' }) {
  try {
    const n = Math.round(Number(qty) || 0);
    if (!(n > 0) || !order?._id || !itemId) return 0;
    const cand = await carrierCandidates(order._id, order.company);
    if (!cand.count) return 0;
    const { Item } = await import('../models/Inventory.js');
    const item = await Item.findOne({ _id: itemId }).select('name code productKind subChildPartDetails.sourceQty').lean();
    if (!item) return 0;
    if (item.productKind === 'SubChildPart') {
      const per = Number(item.subChildPartDetails?.sourceQty) || 0;
      if (!(per >= 1 && Number.isInteger(per))) {
        await PurchasedUnit.updateMany({ _id: { $in: cand.units.map(u => u._id) }, 'trail.what': { $ne: 'Cut into batch' } },
          { $push: { trail: { at: new Date(), by, what: 'Cut into batch', order: order._id, orderNo: order.orderId, note: 'one unit makes several pieces — tracked to the batch' } } });
        return 0;
      }
    }
    const made = await PartLabel.countDocuments({ companyId: order.company, 'builtIn.order': order._id });
    const hint = await holdsHint(order, cand.count);
    const docs = Array.from({ length: n }, (_, i) => ({
      companyId: order.company, item: item._id, itemCode: item.code, itemName: item.name, productKind: item.productKind || '',
      status: 'Unlabelled', holdsCount: hint,
      builtIn: { order: order._id, orderNo: order.orderId, unitIndex: made + i + 1 },
      place: { kind: 'Stock' },
      trail: [{ at: new Date(), by, what: 'Into stock — waiting for its sticker', order: order._id, orderNo: order.orderId }],
    }));
    await PartLabel.insertMany(docs);
    try {
      const notificationService = (await import('./notificationService.js')).default;
      await notificationService.triggerStoreNotification({ action: 'carriers_to_label', data: { count: n, itemName: item.name, orderNo: order.orderId }, targetCompanyId: order.company });
    } catch (e) { console.error('[SerialTrail] label bell failed:', e.message); }
    return n;
  } catch (e) {
    console.error('[SerialTrail] registering stock carriers failed:', e.message);
    return 0;
  }
}

// About how many tracked things one unit of the order holds: what's still
// unpaired ÷ the units not yet labelled (a hint for Store, never a rule).
export async function holdsHint(order, unpaired) {
  const labelled = await PartLabel.countDocuments({ companyId: order.company, 'builtIn.order': order._id, status: { $ne: 'Unlabelled' } });
  const unitsLeft = Math.max(1, (Number(order.orderQuantity) || 1) - labelled);
  return Math.max(1, Math.round((Number(unpaired) || 0) / unitsLeft));
}

// A part back in stock holding serials we already know (a repair, or a return
// from Production): waits for its sticker with those ticked. Several pieces →
// one entry each; the first carries the ticks.
export async function addCarrierEntry({ companyId, order, item, qty, contains = {}, by = '', what = 'Into stock — waiting for its sticker' }) {
  const n = Math.round(Number(qty) || 0);
  if (!(n > 0) || !order?._id || !item?._id) return 0;
  const made = await PartLabel.countDocuments({ companyId: oid(companyId), 'builtIn.order': order._id });
  const units = ids(contains.units).map(oid); const labels = ids(contains.labels).map(oid);
  await PartLabel.insertMany(Array.from({ length: n }, (_, i) => ({
    companyId: oid(companyId), item: item._id, itemCode: item.code, itemName: item.name, productKind: item.productKind || '',
    status: 'Unlabelled', holdsCount: Math.max(1, units.length + labels.length),
    contains: i === 0 ? { units, labels } : { units: [], labels: [] },
    builtIn: { order: order._id, orderNo: order.orderNo || order.orderId || '', unitIndex: made + i + 1 },
    place: { kind: 'Stock' },
    trail: [{ at: new Date(), by, what, order: order._id, orderNo: order.orderNo || order.orderId || '' }],
  })));
  try {
    const notificationService = (await import('./notificationService.js')).default;
    await notificationService.triggerStoreNotification({ action: 'carriers_to_label', data: { count: n, itemName: item.name, orderNo: order.orderNo || order.orderId || '' }, targetCompanyId: oid(companyId) });
  } catch (e) { console.error('[SerialTrail] label bell failed:', e.message); }
  return n;
}

// Once every unit of the order has been dealt with: serials of that order
// nobody paired. Store sees them as a warning (the count stays a hint).
async function leftoverOf(lab) {
  const waiting = await PartLabel.countDocuments({ companyId: lab.companyId, 'builtIn.order': lab.builtIn.order, status: 'Unlabelled' });
  if (waiting) return [];
  const done = await PartLabel.countDocuments({ companyId: lab.companyId, 'builtIn.order': lab.builtIn.order });
  const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
  const SubChildPartJobWorkOrder = (await import('../models/SubChildPartJobWorkOrder.js')).default;
  const order = await ProductionOrder.findById(lab.builtIn.order).select('orderQuantity').lean()
    || await SubChildPartJobWorkOrder.findById(lab.builtIn.order).select('orderQuantity').lean();
  if (done < (Number(order?.orderQuantity) || 1)) return [];
  const cand = await carrierCandidates(lab.builtIn.order, lab.companyId);
  return [...cand.units.map(u => u.serialNumber), ...cand.labels.map(l => l.labelNo)];
}

// Store labels a carrier: its sticker number + what's inside it. nothingInside:
// this piece holds nothing tracked, so it needs no sticker and doesn't block.
export async function labelCarrier({ labelId, companyId, labelNo, unitIds = [], labelIds = [], nothingInside = false, by = '' }) {
  const lab = await PartLabel.findOne({ _id: oid(labelId), companyId: oid(companyId) });
  if (!lab) return { status: 404, message: 'Not found.' };
  if (lab.status !== 'Unlabelled') return { status: 400, message: 'This one is already labelled.' };
  if (nothingInside === true) {
    lab.status = 'Not needed';
    lab.contains = { units: [], labels: [] };
    lab.trail.push({ at: new Date(), by, what: 'Nothing tracked inside — no sticker needed' });
    await lab.save();
    return { label: lab, leftover: await leftoverOf(lab) };
  }
  const no = String(labelNo || '').trim();
  if (!no) return { status: 400, message: 'Enter the sticker number.' };
  const key = no.toUpperCase();
  if (await PartLabel.exists({ companyId: lab.companyId, item: lab.item, labelKey: key })) return { status: 409, message: `Sticker ${no} is already used on a ${lab.itemName} — each sticker number is used once.` };
  const cand = await carrierCandidates(lab.builtIn.order, lab.companyId, { forLabel: lab });
  const checked = checkPicked({ unitIds, labelIds: (labelIds || []).filter(x => String(x) !== String(lab._id)) }, cand);
  if (checked.error) return { status: 400, message: checked.error };
  if (!(checked.unitIds.length + checked.labelIds.length)) return { status: 400, message: 'Pick the serial number(s) inside this one.' };
  lab.labelNo = no; lab.labelKey = key; lab.status = 'Labelled'; lab.labelledAt = new Date(); lab.labelledBy = by;
  lab.contains = { units: checked.unitIds.map(oid), labels: checked.labelIds.map(oid) };
  lab.trail.push({ at: new Date(), by, what: 'Labelled', labelNo: no, note: `holds ${checked.unitIds.length + checked.labelIds.length}` });
  try { await lab.save(); } catch (e) {
    if (e?.code === 11000) return { status: 409, message: `Sticker ${no} is already used on a ${lab.itemName}.` };
    throw e;
  }
  await move({ unitIds: checked.unitIds, labelIds: checked.labelIds, place: { kind: 'Fitted', label: lab._id, labelNo: no, order: lab.builtIn.order, orderNo: lab.builtIn.orderNo }, what: `Fitted in ${lab.itemName} ${no}`, by, from: ['Issued'] });
  return { label: lab, leftover: await leftoverOf(lab) };
}

// ── Many pieces of a part in one go (Label carriers, 5 Nov) ───────────────

const pieceName = (lab) => `${lab.itemName} ${lab.builtIn?.orderNo || ''} unit ${lab.builtIn?.unitIndex || ''}`.replace(/\s+/g, ' ').trim();
const holdsKnown = (lab) => !!(lab.contains?.units?.length || lab.contains?.labels?.length);

// One pool of what can go inside: its options, and each part's usual count per
// piece (what's available of it ÷ the pieces sharing this pool). A hint for the
// fill button, never a rule.
function poolOf(key, orderNo, cand, pieces) {
  const options = [
    ...cand.units.map(u => ({ id: u._id, kind: 'unit', no: u.serialNumber, itemName: u.itemName, sub: `${u.vendorName || ''}${u.place?.orderNo && u.place.orderNo !== orderNo ? ` · via ${u.place.orderNo}` : ''}` })),
    ...cand.labels.map(l => ({ id: l._id, kind: 'label', no: l.labelNo, itemName: l.itemName, sub: 'sticker' })),
  ];
  const counts = new Map();
  for (const o of options) counts.set(o.itemName, (counts.get(o.itemName) || 0) + 1);
  const types = [...counts].map(([itemName, available]) => ({ itemName, available, perPiece: Math.max(1, Math.round(available / Math.max(1, pieces))) }));
  return { key, orderNo, options, types };
}

// Everything of one part waiting for a sticker, for the Label carriers table.
// Pieces of one order share one pool; a repaired or returned piece already knows
// what it holds, so it has a pool of its own with those ticked.
export async function waitingForItem(companyId, itemId) {
  const cid = oid(companyId);
  const pieces = await PartLabel.find({ companyId: cid, item: oid(itemId), status: 'Unlabelled', 'place.kind': 'Stock' })
    .select('itemName itemCode builtIn contains createdAt').sort({ createdAt: 1, 'builtIn.unitIndex': 1 }).lean();
  const sharing = new Map();
  for (const p of pieces) if (!holdsKnown(p)) sharing.set(String(p.builtIn.order), (sharing.get(String(p.builtIn.order)) || 0) + 1);
  const pools = {};
  const rows = [];
  for (const p of pieces) {
    const known = holdsKnown(p);
    const key = known ? `piece:${p._id}` : String(p.builtIn.order);
    if (!pools[key]) {
      const cand = await carrierCandidates(p.builtIn.order, cid, known ? { forLabel: p } : {});
      pools[key] = poolOf(key, p.builtIn.orderNo, cand, known ? 1 : sharing.get(key));
    }
    rows.push({ _id: p._id, orderNo: p.builtIn.orderNo, unitIndex: p.builtIn.unitIndex, createdAt: p.createdAt, pool: key, known, picked: known ? [...(p.contains.units || []), ...(p.contains.labels || [])].map(String) : [] });
  }
  const last = await PartLabel.findOne({ companyId: cid, item: oid(itemId), labelKey: { $gt: '' } }).sort({ labelledAt: -1, _id: -1 }).select('labelNo').lean();
  return { itemName: pieces[0]?.itemName || '', itemCode: pieces[0]?.itemCode || '', lastLabelNo: last?.labelNo || '', pieces: rows, pools };
}

// Saves several pieces together. rows: [{ labelId, labelNo, unitIds, labelIds }
// or { labelId, nothingInside: true }]. Every row is checked first: one problem
// and nothing is saved, with every problem named at once. Each save then goes
// through labelCarrier, so moves, trail and the leftover warning are the same.
export async function labelCarriersBulk({ companyId, rows, by = '' }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { status: 400, message: 'Nothing to save yet: enter a sticker number first.', problems: [] };
  if (list.length > 500) return { status: 400, message: 'Save up to 500 at a time.', problems: [] };
  const cid = oid(companyId);
  const labs = await PartLabel.find({ _id: { $in: ids(list.map(r => r.labelId)).map(oid) }, companyId: cid }).lean();
  const byId = new Map(labs.map(l => [String(l._id), l]));
  const problems = [];
  const seenPiece = new Set();
  const numbers = new Map();
  const things = new Map();
  const poolCache = new Map();
  for (const r of list) {
    const lab = byId.get(String(r.labelId));
    if (!lab) { problems.push('A piece on this list no longer exists. Refresh the page.'); continue; }
    const name = pieceName(lab);
    if (lab.status !== 'Unlabelled') { problems.push(`${name} is already done. Refresh the page.`); continue; }
    if (seenPiece.has(String(lab._id))) { problems.push(`${name} is on the list twice.`); continue; }
    seenPiece.add(String(lab._id));
    if (r.nothingInside === true) continue;

    const no = String(r.labelNo || '').trim();
    if (!no) problems.push(`${name}: enter the sticker number.`);
    else {
      const key = no.toUpperCase();
      const numKey = `${lab.item}|${key}`;
      if (numbers.has(numKey)) problems.push(`Sticker ${no} is on two pieces: ${numbers.get(numKey)} and ${name}.`);
      else {
        numbers.set(numKey, name);
        if (await PartLabel.exists({ companyId: cid, item: lab.item, labelKey: key })) problems.push(`Sticker ${no} is already used on a ${lab.itemName}.`);
      }
    }

    const known = holdsKnown(lab);
    const poolKey = String(lab.builtIn.order);
    let cand = known ? null : poolCache.get(poolKey);
    if (!cand) {
      cand = await carrierCandidates(lab.builtIn.order, cid, known ? { forLabel: lab } : {});
      if (!known) poolCache.set(poolKey, cand);
    }
    const checked = checkPicked({ unitIds: r.unitIds, labelIds: r.labelIds }, cand);
    if (checked.error) { problems.push(`${name}: ${checked.error}`); continue; }
    if (!(checked.unitIds.length + checked.labelIds.length)) { problems.push(`${name}: pick what's inside it, or mark it Nothing inside.`); continue; }
    const labelNames = new Map(cand.labels.map(x => [String(x._id), x.labelNo]));
    const unitNames = new Map(cand.units.map(x => [String(x._id), x.serialNumber]));
    for (const id of [...checked.unitIds, ...checked.labelIds]) {
      if (things.has(id)) problems.push(`${unitNames.get(id) || labelNames.get(id)} is on two pieces: ${things.get(id)} and ${name}.`);
      else things.set(id, name);
    }
  }
  if (problems.length) return { status: 400, message: problems.join(' · '), problems };

  const saved = []; const failed = []; const leftover = [];
  for (const r of list) {
    const lab = byId.get(String(r.labelId));
    const out = await labelCarrier({ labelId: r.labelId, companyId: cid, labelNo: r.labelNo, unitIds: r.unitIds, labelIds: r.labelIds, nothingInside: r.nothingInside, by });
    if (out.status) { failed.push(`${pieceName(lab)}: ${out.message}`); continue; }
    saved.push(String(r.labelId));
    if (out.leftover?.length) leftover.push({ orderNo: lab.builtIn.orderNo, serials: out.leftover });
  }
  return { saved, failed, leftover };
}

// ── A cascade part returned by Production (2 Nov review) ──────────────────

// The serials built into a part by the cascade orders that delivered it to this
// order, not already on a pending return. code: the part's code.
export async function insideCandidates(orderId, code, companyId) {
  const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
  const MaterialReturnLog = (await import('../models/MaterialReturnLog.js')).default;
  const order = await ProductionOrder.findOne({ _id: oid(orderId), company: oid(companyId) }).select('cascadeCovers').lean();
  const cover = (order?.cascadeCovers || []).find(c => c.partCode === code);
  const roots = (cover?.orders || []).map(o => o.orderRef).filter(Boolean);
  if (!roots.length) return { units: [], labels: [], count: 0 };
  const tree = (await Promise.all(roots.map(r => orderTree(r, companyId)))).flat();
  const pending = await MaterialReturnLog.find({ productionOrderId: oid(orderId), status: 'Pending' }).select('insideUnitIds insideLabelIds').lean();
  const onReturn = new Set(pending.flatMap(l => [...(l.insideUnitIds || []), ...(l.insideLabelIds || [])]).map(String));
  for (const id of await heldInWaitingCarriers(companyId)) onReturn.add(id);
  const [units, labels] = await Promise.all([
    PurchasedUnit.find({ companyId: oid(companyId), 'place.kind': 'Issued', 'place.order': { $in: tree } }).select('serialNumber itemName vendorName place').sort({ itemName: 1, serialKey: 1 }).lean(),
    PartLabel.find({ companyId: oid(companyId), 'place.kind': 'Issued', 'place.order': { $in: tree } }).select('labelNo itemName place').sort({ itemName: 1, labelKey: 1 }).lean(),
  ]);
  const free = (r) => !onReturn.has(String(r._id));
  const u = units.filter(free); const l = labels.filter(free);
  return { units: u, labels: l, count: u.length + l.length };
}

// ── A Sub Child Part piece holding a whole source unit (2 Nov review) ─────

// The source serials still with this order, and how many one piece holds. A
// fraction per piece stays "Cut into batch": nothing to pick (perPiece 0).
export async function scpPieceSerials(companyId, orderRef, itemId) {
  const { Item } = await import('../models/Inventory.js');
  const item = await Item.findOne({ _id: itemId, companyId: oid(companyId) }).select('code name unit subChildPartDetails.sourceItem subChildPartDetails.sourceQty').lean();
  const per = Number(item?.subChildPartDetails?.sourceQty) || 0;
  const source = item?.subChildPartDetails?.sourceItem;
  if (!source || !(per >= 1 && Number.isInteger(per))) return { item, perPiece: 0, units: [] };
  const [all, held] = await Promise.all([
    PurchasedUnit.find({ companyId: oid(companyId), item: source, 'place.kind': 'Issued', 'place.order': oid(orderRef) })
      .select('serialNumber itemName vendorName poNumber place').sort({ serialKey: 1 }).lean(),
    heldInWaitingCarriers(companyId),
  ]);
  return { item, perPiece: per, units: all.filter(u => !held.has(String(u._id))) };
}

// The serials in `qty` written-off pieces. onHand: the pieces this decision is
// about; the rest of their source units have no serial. { error } or the pick.
export async function checkPiecePick({ companyId, orderRef, itemId, qty, onHand, unitIds }) {
  const s = await scpPieceSerials(companyId, orderRef, itemId);
  const checked = checkPicked({ unitIds }, { units: s.units, labels: [] });
  if (checked.error) return { error: checked.error };
  if (!s.units.length) return { unitIds: [], item: s.item, perPiece: s.perPiece };
  const rule = pickRule({ qty: qty * s.perPiece, tracked: s.units.length, untracked: untrackedCount(onHand * s.perPiece, s.units.length) });
  const problem = pickProblem(checked.unitIds.length, rule, 'serial number', 'in these pieces');
  if (problem) return { error: problem };
  const skip = noSerialCheck({ itemId: s.item?._id, name: s.units[0].itemName, picked: checked.unitIds.length, rule, tracked: s.units.length });
  return { unitIds: checked.unitIds, item: s.item, perPiece: s.perPiece, skip };
}

// QC scrapped them: QC rejects the whole piece, so it goes on Defective Inventory
// with its serial linked. Pieces with no serial are written off as before.
export async function applyScrappedPieces({ companyId, order, picked, by = '', note = '' }) {
  if (!picked?.unitIds?.length) return;
  await move({
    unitIds: picked.unitIds, place: { kind: 'Defective', order: order._id, orderNo: order.orderId, defectiveOf: picked.item.code },
    what: `Scrapped at QC inside ${picked.item.name}`, by, note, from: ['Issued'],
  });
  const DefectiveInventory = (await import('../models/DefectiveMaterial.js')).default;
  await DefectiveInventory.findOneAndUpdate(
    { materialCode: picked.item.code, companyId: oid(companyId) },
    { $inc: { quantity: Math.ceil(picked.unitIds.length / picked.perPiece) }, $setOnInsert: { materialName: picked.item.name, unit: picked.item.unit || 'Pieces' } },
    { upsert: true },
  );
}

// ── Spare parts on a service visit, and the customer's dates (2 Nov review) ──

// What technicians fitted at this customer's: { serialNumber, ..., ticketNo, fittedAt, inPart }.
export async function unitsFittedOnVisits(companyId, mobile) {
  if (!mobile) return [];
  const q = { companyId: oid(companyId), 'place.kind': 'Sold', 'place.customerMobile': String(mobile) };
  const sel = 'serialNumber itemName vendorName poNumber receivedAt vendorWarrantyMonths place trail';
  const [units, labels] = await Promise.all([PurchasedUnit.find(q).select(sel).lean(), PartLabel.find(q).select('labelNo itemName place trail contains').lean()]);
  const when = (r) => r.trail?.[r.trail.length - 1]?.at || null;
  const rows = units.map(u => ({ ...u, ticketNo: u.place.ticketNo, fittedAt: when(u), inPart: '' }));
  for (const lab of labels) {
    const { units: inside } = await openLabels([lab._id]);
    const docs = inside.length ? await PurchasedUnit.find({ _id: { $in: inside.map(oid) } }).select(sel).lean() : [];
    for (const u of docs) rows.push({ ...u, ticketNo: lab.place.ticketNo, fittedAt: when(lab), inPart: `${lab.itemName} · sticker ${lab.labelNo}` });
  }
  return rows.map(({ trail, place, ...r }) => r);
}

// The order's first "Reached Safely" date, or null.
export async function orderDeliveredOn(companyId, orderCode) {
  if (!orderCode) return null;
  const DispatchOrder = (await import('../models/DispatchOrder.js')).default;
  const rows = await DispatchOrder.find({ company: oid(companyId), orderId: orderCode, 'customerConfirmation.status': 'Reached Safely' })
    .select('actualDeliveryDate customerConfirmation.confirmedAt').lean();
  const dates = rows.map(r => new Date(r.actualDeliveryDate || r.customerConfirmation?.confirmedAt)).filter(d => !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
}

// ── Defective Inventory (2 Nov review) ────────────────────────────────────

// What's tracked under a Defective row. own: the piece itself (its vendor serial,
// or its sticker). inside: a serial built into a stickerless part. A unit made
// Defective before this has no defectiveOf: it sits under its own item's code.
export async function defectiveTracked(companyId, code) {
  const { Item } = await import('../models/Inventory.js');
  const item = await Item.findOne({ code, companyId: oid(companyId) }).select('_id code name productKind').lean();
  const q = {
    companyId: oid(companyId), 'place.kind': 'Defective',
    $or: [{ 'place.defectiveOf': code }, ...(item ? [{ item: item._id, 'place.defectiveOf': { $in: ['', null] } }] : [])],
  };
  const [units, labels] = await Promise.all([
    PurchasedUnit.find(q).select('serialNumber itemName item vendorName poNumber place').sort({ serialKey: 1 }).lean(),
    PartLabel.find(q).select('labelNo itemName item contains place builtIn').sort({ labelKey: 1 }).lean(),
  ]);
  return { item, units: units.map(u => ({ ...u, own: !!item && String(u.item) === String(item._id) })), labels };
}

// The pick on a Repair / Scrap: { error } or the clean lists. A plain piece uses
// the usual rule; a part holds several, so at least 1 unless Store says nothing
// tracked is in these pieces.
export async function checkDefectivePick({ companyId, code, qty, rowQty, unitIds, labelIds, nothingInside }) {
  const t = await defectiveTracked(companyId, code);
  const checked = checkPicked({ unitIds, labelIds }, t);
  if (checked.error) return { error: checked.error };
  const own = t.units.filter(u => u.own);
  const inside = t.units.filter(u => !u.own);
  const ownIds = new Set(own.map(u => String(u._id)));
  const pickedOwn = checked.unitIds.filter(i => ownIds.has(i)).length + checked.labelIds.length;
  const pickedInside = checked.unitIds.length - checked.unitIds.filter(i => ownIds.has(i)).length;
  const rule = pickRule({ qty, tracked: own.length + t.labels.length, untracked: untrackedCount(rowQty, own.length + t.labels.length) });
  const problem = pickProblem(pickedOwn, rule, 'serial number', "of what you're repairing or scrapping");
  if (problem) return { error: problem };
  if (inside.length && !pickedInside && !pickedOwn && nothingInside !== true) {
    return { error: 'Say which serial number(s) are inside, or tick "Nothing tracked inside".' };
  }
  // A part holding serials has its forced choice above, so it isn't warned.
  const skip = inside.length ? null : noSerialCheck({ itemId: t.item?._id, name: t.item?.name || code, picked: pickedOwn, rule, tracked: own.length + t.labels.length });
  return { ...checked, tracked: t, skip };
}

// Everything inside stickers: the stickers themselves and the units they hold.
async function openLabels(labelIds) {
  const seen = new Set(); const queue = [...labelIds]; const units = new Set();
  while (queue.length) {
    const id = String(queue.shift());
    if (seen.has(id)) continue;
    seen.add(id);
    const lab = await PartLabel.findById(id).select('contains').lean();
    for (const u of lab?.contains?.units || []) units.add(String(u));
    queue.push(...(lab?.contains?.labels || []));
  }
  return { labels: [...seen], units: [...units] };
}

// Repair: back to stock. A sticker keeps what's in it. A serial from a
// stickerless part goes back on its order and the piece waits for a sticker
// with it ticked. checked: what checkDefectivePick returned.
export async function repairDefective({ companyId, qty, checked, by = '' }) {
  const { tracked, unitIds, labelIds } = checked;
  const byId = new Map(tracked.units.map(u => [String(u._id), u]));
  const own = unitIds.filter(i => byId.get(i)?.own);
  const inside = unitIds.filter(i => !byId.get(i)?.own);
  await move({ unitIds: own, labelIds, place: { kind: 'Stock' }, what: 'Repaired — back in stock', by, from: ['Defective'] });
  const groups = new Map();
  for (const i of inside) {
    const u = byId.get(i);
    const k = String(u.place?.order || '');
    if (!groups.has(k)) groups.set(k, { order: u.place?.order, orderNo: u.place?.orderNo || '', units: [] });
    groups.get(k).units.push(i);
  }
  let left = Math.round(Number(qty) || 0) - own.length - labelIds.length;
  for (const g of groups.values()) {
    await move({ unitIds: g.units, place: { kind: 'Issued', order: g.order, orderNo: g.orderNo }, what: 'Repaired — back in stock inside its part', by, from: ['Defective'] });
    const n = Math.max(1, left);
    await addCarrierEntry({ companyId, order: { _id: g.order, orderNo: g.orderNo }, item: tracked.item, qty: n, contains: { units: g.units }, by, what: 'Repaired — waiting for its sticker' });
    left -= n;
  }
}

// Scrap: the piece and everything inside it. A sticker is retired, never reused.
export async function scrapDefective({ checked, by = '' }) {
  const { unitIds, labelIds, tracked } = checked;
  const opened = await openLabels(labelIds);
  const place = { kind: 'Scrapped' };
  await move({ unitIds, labelIds: opened.labels, place, what: 'Scrapped from Defective Inventory', by, from: ['Defective'] });
  await move({ unitIds: opened.units, labelIds: opened.labels, place, what: `Scrapped with its part (${tracked.item?.name || 'part'})`, by, from: ['Fitted', 'Defective'] });
  if (opened.labels.length) await PartLabel.updateMany({ _id: { $in: opened.labels.map(oid) } }, { $set: { status: 'Retired' } });
}

// Store's daily reminder while carriers wait for a sticker (D16).
export async function runLabelReminder() {
  const groups = await PartLabel.aggregate([{ $match: { status: 'Unlabelled', 'place.kind': 'Stock' } }, { $group: { _id: '$companyId', count: { $sum: 1 } } }]);
  const notificationService = (await import('./notificationService.js')).default;
  for (const g of groups) {
    try { await notificationService.triggerStoreNotification({ action: 'carriers_to_label_daily', data: { count: g.count }, targetCompanyId: g._id }); }
    catch (e) { console.error('[SerialTrail] label reminder failed:', e.message); }
  }
  return { companies: groups.length, labels: groups.reduce((s, g) => s + g.count, 0) };
}

// ── The customer (slice D, §5.8 / §6) ─────────────────────────────────────

// Up from a production order: its parents (cascade orders deliver to them) to
// the top order; the customer's Order when the top order has one.
async function chainUp(orderRef, companyId) {
  const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
  const SubChildPartJobWorkOrder = (await import('../models/SubChildPartJobWorkOrder.js')).default;
  const chain = [];
  let cur = orderRef;
  for (let depth = 0; cur && depth < 8; depth++) {
    const sel = 'orderId orderKind orderCode demandRefId deliverToParent machineName itemName';
    const o = await ProductionOrder.findOne({ _id: cur, company: oid(companyId) }).select(sel).lean()
      || await SubChildPartJobWorkOrder.findOne({ _id: cur, company: oid(companyId) }).select(sel).lean();
    if (!o) break;
    const KIND = { Machine: 'Machine', ChildPart: 'Child Part', SubChildPart: 'Sub Child Part' };
    chain.push({ orderNo: o.orderId, kind: KIND[o.orderKind] || (o.orderKind ? o.orderKind : 'Sub Child Part job work'), name: o.machineName || o.itemName || '' });
    if (o.orderCode) return { chain, customerOrderCode: o.orderCode };
    cur = o.deliverToParent ? o.demandRefId : null;
  }
  return { chain, customerOrderCode: '' };
}

// Where a unit / sticker ended up: { steps: [{ what, ref }], customerOrderCode,
// usedIn }. Walks: its place → the sticker it's fitted in (and that sticker's
// place) → the production order → its parents → the customer's Order.
export async function trailOf(rec, companyId) {
  const steps = [];
  let place = rec?.place || {};
  for (let depth = 0; depth < 6; depth++) {
    if (!place?.kind || place.kind === 'Stock') { steps.push({ what: 'In stock' }); return { steps, customerOrderCode: '' }; }
    if (place.kind === 'Sold' && place.ticketNo) { steps.push({ what: 'Fitted on service visit', ref: place.ticketNo }); return { steps, customerOrderCode: '', ticketNo: place.ticketNo }; }
    if (place.kind === 'Sold') { steps.push({ what: 'Sold', ref: place.customerOrderCode }); return { steps, customerOrderCode: place.customerOrderCode || '' }; }
    if (['Defective', 'Lost', 'Scrapped'].includes(place.kind)) { steps.push({ what: place.kind, ref: place.orderNo }); return { steps, customerOrderCode: '' }; }
    if (place.kind === 'Used') { steps.push({ what: 'Used to make', ref: place.orderNo }); return { steps, customerOrderCode: '', usedIn: place.orderNo }; }
    if (place.kind === 'Fitted' && place.label) {
      const lab = await PartLabel.findOne({ _id: place.label }).select('labelNo itemName place').lean();
      steps.push({ what: `In ${lab?.itemName || 'part'}`, ref: `sticker ${lab?.labelNo || place.labelNo}` });
      if (!lab) return { steps, customerOrderCode: '' };
      place = lab.place;
      continue;
    }
    // Inside a piece in stock, waiting for its sticker: not with its old order.
    if (rec?._id) {
      const waiting = await PartLabel.findOne({ status: 'Unlabelled', 'place.kind': 'Stock', $or: [{ 'contains.units': rec._id }, { 'contains.labels': rec._id }] }).select('itemName').lean();
      if (waiting) { steps.push({ what: `In stock, in ${waiting.itemName}`, ref: 'waiting for its sticker' }); return { steps, customerOrderCode: '' }; }
    }
    // Issued to a production order → up its chain.
    const up = await chainUp(place.order, companyId);
    for (const c of up.chain) steps.push({ what: `${c.kind} order`, ref: c.orderNo });
    if (up.customerOrderCode) steps.push({ what: 'Customer order', ref: up.customerOrderCode });
    return { steps, customerOrderCode: up.customerOrderCode };
  }
  return { steps, customerOrderCode: '' };
}

// Everything traced into a customer's Order: the vendor serials in it (with
// the part / sticker they're in). For Complaints → "Vendor parts in this order".
export async function unitsInCustomerOrder(companyId, orderCode) {
  const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
  const cid = oid(companyId);
  const tops = await ProductionOrder.find({ company: cid, orderCode, orderKind: { $in: ['Machine', null] } }).select('_id').lean();
  const trees = (await Promise.all(tops.map(t => orderTree(t._id, cid)))).flat();
  const unitIds = new Set(); const labelQueue = [];
  const inPart = new Map(); // unit id → where it is (order / sticker)
  if (trees.length) {
    const [units, labels] = await Promise.all([
      PurchasedUnit.find({ companyId: cid, 'place.kind': 'Issued', 'place.order': { $in: trees } }).select('_id place').lean(),
      PartLabel.find({ companyId: cid, 'place.kind': 'Issued', 'place.order': { $in: trees } }).select('_id').lean(),
    ]);
    const held = await heldInWaitingCarriers(cid);
    for (const u of units) { if (held.has(String(u._id))) continue; unitIds.add(String(u._id)); inPart.set(String(u._id), u.place.orderNo); }
    labelQueue.push(...labels.filter(l => !held.has(String(l._id))).map(l => l._id));
  }
  const soldUnits = await PurchasedUnit.find({ companyId: cid, 'place.kind': 'Sold', 'place.customerOrderCode': orderCode }).select('_id').lean();
  for (const u of soldUnits) { unitIds.add(String(u._id)); inPart.set(String(u._id), 'sold as is'); }
  const soldLabels = await PartLabel.find({ companyId: cid, 'place.kind': 'Sold', 'place.customerOrderCode': orderCode }).select('_id').lean();
  labelQueue.push(...soldLabels.map(l => l._id));
  // Open every sticker: what's fitted in it (and stickers inside stickers).
  const seen = new Set();
  while (labelQueue.length) {
    const lid = labelQueue.shift();
    if (seen.has(String(lid))) continue;
    seen.add(String(lid));
    const lab = await PartLabel.findOne({ _id: lid }).select('labelNo itemName contains').lean();
    if (!lab) continue;
    for (const u of lab.contains?.units || []) { unitIds.add(String(u)); inPart.set(String(u), `${lab.itemName} · sticker ${lab.labelNo}`); }
    labelQueue.push(...(lab.contains?.labels || []));
  }
  const units = await PurchasedUnit.find({ _id: { $in: [...unitIds].map(oid) } })
    .select('serialNumber itemName vendor vendorName poNumber receivedAt vendorWarrantyMonths place').sort({ itemName: 1, serialKey: 1 }).lean();
  return units.map(u => ({ ...u, inPart: inPart.get(String(u._id)) || '' }));
}
