// Serial numbers / lots of what Store receives from vendors (procurement-v2,
// serial numbers Part 1, 2026-10-13 — models/PurchasedUnit.js;
// docs/procurement-v2/serial-numbers-and-warranty-discussion-2026-10.md §4).
//
//   Receive — an item the vendor gave a warranty on, counted in pieces, gets
//             one serial per piece (the count must match what arrived); its
//             warranty card is one for all the pieces or one for each. Anything
//             else gets one serial / lot number for the receipt, as before.
//   QC      — a serialised job's rejections are the serials QC ticks; a lot's
//             are a quantity, as before.
//
// No transactions on this database: everything is checked before anything is
// written, and the records go in before the requests are marked Received (the
// unique index then refuses a serial taken a moment earlier by someone else).
import mongoose from 'mongoose';
import PurchasedUnit from '../models/PurchasedUnit.js';
import '../models/PurchaseRejection.js'; // listUnits populates `rejections`

// ── Pure helpers ───────────────────────────────────────────────────────────

const COUNTABLE = /^(pieces?|pcs?\.?|pc\.?|nos?\.?|numbers?|units?|sets?|each|ea)$/i;
export const isCountableUnit = (unit) => COUNTABLE.test(String(unit || '').trim());

export const serialKeyOf = (s) => String(s || '').trim().toUpperCase();

// One serial per piece: a warranty from the vendor, and counted in pieces.
export const isSerialised = ({ warrantyMonths, stockUnit }) => Number(warrantyMonths) > 0 && isCountableUnit(stockUnit);

// A received quantity as whole pieces, or null when it isn't whole.
export function wholePieces(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n);
  return Math.abs(n - r) < 1e-6 ? r : null;
}

// `total` whole pieces shared out by `weights`, so they add up exactly
// (largest remainder; ties go to the earlier request).
export function splitWhole(total, weights) {
  const w = weights.map(x => (Number(x) > 0 ? Number(x) : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const exact = w.map(x => (sum > 0 ? (total * x) / sum : total / w.length));
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i] += 1;
  return out;
}

// The serials Store sent: a JSON array, or text with one per line.
export function readSerialList(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try { list = JSON.parse(t); } catch { return { error: 'The serial numbers could not be read — refresh the page.' }; }
    } else {
      list = t.split(/\r?\n/);
    }
  }
  if (!Array.isArray(list)) list = [];
  const serials = list.map(s => String(s ?? '').trim()).filter(Boolean);
  const seen = new Set();
  const duplicates = new Set();
  for (const s of serials) {
    const k = serialKeyOf(s);
    if (seen.has(k)) duplicates.add(s); else seen.add(k);
  }
  if (serials.some(s => s.length > 80)) return { error: 'A serial number can be up to 80 characters.' };
  return { serials, duplicates: [...duplicates] };
}

const list = (arr, n = 5) => (arr.length > n ? `${arr.slice(0, n).join(', ')} and ${arr.length - n} more` : arr.join(', '));

// Warranty cards for a serialised receipt: one for all the pieces, or one for
// each. Returns { error } or { shared, byKey } (byKey: serialKey → file).
export function matchCards({ serials, files = [], cardSerials, required }) {
  const n = serials.length;
  if (!files.length) return required ? { error: 'Upload the warranty card — one for all the pieces, or one for each.' } : { shared: null, byKey: null };
  if (files.length === 1) return { shared: files[0], byKey: null };
  if (files.length !== n) {
    return { error: `Upload one warranty card for all ${n} pieces, or one for each of them — ${files.length} were uploaded.` };
  }
  let names = cardSerials;
  if (typeof names === 'string') { try { names = JSON.parse(names); } catch { names = null; } }
  if (!Array.isArray(names) || names.length !== files.length) return { error: 'Which card belongs to which serial number could not be read — refresh the page.' };
  const wanted = new Set(serials.map(serialKeyOf));
  const byKey = new Map();
  for (let i = 0; i < names.length; i++) {
    const k = serialKeyOf(names[i]);
    if (!wanted.has(k) || byKey.has(k)) return { error: 'Each serial number needs its own warranty card — refresh the page and attach them again.' };
    byKey.set(k, files[i]);
  }
  return { shared: null, byKey };
}

export const cardUrl = (file) => (file ? `/uploads/warranty-cards/${file.filename}` : null);

// What the request itself shows (the old single serial field).
export function serialSummary(serials) {
  if (!serials.length) return '';
  if (serials.length === 1) return serials[0];
  return `${serials[0]} … ${serials[serials.length - 1]} (${serials.length})`;
}

// ── Receive ────────────────────────────────────────────────────────────────

// Serials of this item already in our records (as typed).
export async function takenSerials(companyId, itemKey, serials) {
  const keys = serials.map(serialKeyOf);
  if (!keys.length) return [];
  const rows = await PurchasedUnit.find({ companyId, itemKey, isLot: false, serialKey: { $in: keys } }).select('serialNumber').lean();
  return rows.map(r => r.serialNumber);
}

export const itemKeyOf = (itemId, itemName) => (itemId ? String(itemId) : `name:${String(itemName || '').trim().toLowerCase()}`);

// Checks a line receive and builds the records — nothing is written.
//   prs       — the requests being received, in order, each with `qty` (its
//               quantity for QC, in the stock unit) set by the caller
//   serialised — one serial per piece (isSerialised)
// Returns { status, message } on a refusal, or { docs, perPr } where perPr
// maps a request id → { serialNumber (summary), warrantyCardUrl }.
export async function planReceive({ companyId, po, line, vendorName, item, itemName, prs, serialised, warrantyMonths, body, files = [], user, now = new Date() }) {
  const itemKey = itemKeyOf(item, itemName);
  const base = {
    companyId, item: item || null, itemKey, itemName,
    vendor: po?.supplier?._id || po?.supplier || null, vendorName: vendorName || '',
    purchaseOrder: po?._id || null, poNumber: po?.purchaseOrderNumber || '', lineId: line?._id || null,
    vendorWarrantyMonths: Number(warrantyMonths) || 0,
    receivedAt: now, receivedBy: user?._id || null, receivedByName: user?.fullName || user?.username || '',
  };
  const docs = [];
  const perPr = new Map();

  if (!serialised) {
    const lot = String(body?.serialNumber || '').trim();
    if (!lot) return { status: 400, message: 'Enter the serial / lot number.' };
    if (lot.length > 80) return { status: 400, message: 'The serial / lot number can be up to 80 characters.' };
    if (files.length > 1) return { status: 400, message: 'Upload one warranty card for this receipt.' };
    const url = cardUrl(files[0]);
    for (const pr of prs) {
      docs.push({ ...base, _id: new mongoose.Types.ObjectId(), purchaseRequest: pr._id, serialNumber: lot, serialKey: serialKeyOf(lot), isLot: true, lotQty: Number(pr.qty) || 0, qtyUnit: pr.qtyUnit || '', warrantyCardUrl: url });
      perPr.set(String(pr._id), { serialNumber: lot, warrantyCardUrl: url });
    }
    return { docs, perPr };
  }

  const read = readSerialList(body?.serialNumbers);
  if (read.error) return { status: 400, message: read.error };
  const { serials } = read;
  const total = prs.reduce((s, pr) => s + (Number(pr.qty) || 0), 0);
  if (read.duplicates.length) return { status: 400, message: `Each piece needs its own serial number — repeated: ${list(read.duplicates)}.` };
  if (serials.length !== total) return { status: 400, message: `${total} pieces arrived — enter ${total} serial numbers, one per piece (${serials.length} entered).` };
  const taken = await takenSerials(companyId, itemKey, serials);
  if (taken.length) return { status: 409, message: `Already received earlier for this item: ${list(taken)}. Check the serial numbers.` };
  const cards = matchCards({ serials, files, cardSerials: body?.cardSerials, required: Number(warrantyMonths) > 0 });
  if (cards.error) return { status: 400, message: cards.error };
  const sharedUrl = cardUrl(cards.shared);

  let at = 0;
  for (const pr of prs) {
    const own = serials.slice(at, at + (Number(pr.qty) || 0));
    at += own.length;
    for (const s of own) {
      docs.push({
        ...base, _id: new mongoose.Types.ObjectId(), purchaseRequest: pr._id,
        serialNumber: s, serialKey: serialKeyOf(s), isLot: false, lotQty: 1, qtyUnit: pr.qtyUnit || '',
        warrantyCardUrl: cards.byKey ? cardUrl(cards.byKey.get(serialKeyOf(s))) : sharedUrl,
      });
    }
    perPr.set(String(pr._id), { serialNumber: serialSummary(own), warrantyCardUrl: sharedUrl });
  }
  return { docs, perPr };
}

// Writes the planned records. A serial someone else saved a moment ago is
// refused by the unique index — then nothing of this receipt is kept.
export async function saveReceive(docs) {
  if (!docs.length) return { ok: true };
  try {
    await PurchasedUnit.insertMany(docs, { ordered: true });
    return { ok: true };
  } catch (err) {
    await PurchasedUnit.deleteMany({ _id: { $in: docs.map(d => d._id) } });
    if (err?.code === 11000) return { ok: false, status: 409, message: 'One of these serial numbers was just received for this item — check them and try again.' };
    throw err;
  }
}

export const discardReceive = (docs) => PurchasedUnit.deleteMany({ _id: { $in: docs.map(d => d._id) } });

// After the request's QC job exists: link the records to it. Never throws.
export async function linkQcJob(prId) {
  try {
    const job = await mongoose.model('QCJob').findOne({ source: 'Purchase', purchaseRequestId: prId }).select('_id').lean();
    if (job) await PurchasedUnit.updateMany({ purchaseRequest: prId, qcJob: null }, { qcJob: job._id });
  } catch (err) {
    console.error('Linking serial numbers to the QC job failed:', err.message);
  }
}

// A request received through the old single-request route: one lot record
// with its serial. Never throws.
export async function recordLegacyReceive(pr, user) {
  try {
    if (!pr?.serialNumber || await PurchasedUnit.exists({ purchaseRequest: pr._id })) return;
    const po = pr.purchaseOrder && typeof pr.purchaseOrder === 'object' ? pr.purchaseOrder : null;
    await PurchasedUnit.create({
      companyId: pr.companyId, item: null, itemKey: itemKeyOf(null, pr.productName), itemName: pr.productName,
      vendor: po?.supplier?._id || po?.supplier || null, purchaseOrder: po?._id || null, poNumber: po?.purchaseOrderNumber || '',
      purchaseRequest: pr._id, serialNumber: pr.serialNumber, serialKey: serialKeyOf(pr.serialNumber), isLot: true,
      lotQty: Number(pr.convertedQuantity) || Number(pr.quantity) || 0, qtyUnit: pr.unit || '',
      vendorWarrantyMonths: Number(pr.warrantyPeriod) || 0, warrantyCardUrl: pr.warrantyCardUrl || null,
      receivedAt: pr.receivedAt || new Date(), receivedBy: user?._id || null, receivedByName: user?.fullName || user?.username || '',
    });
    await linkQcJob(pr._id);
  } catch (err) {
    console.error('Recording the received lot failed:', err.message);
  }
}

// ── QC ─────────────────────────────────────────────────────────────────────

const isPurchaseJob = (job) => job?.source === 'Purchase' && job.purchaseRequestId;

// A serialised job's pieces still waiting for QC (none for a lot / old receipt).
export async function piecesInQc(job) {
  if (!isPurchaseJob(job)) return [];
  return PurchasedUnit.find({ purchaseRequest: job.purchaseRequestId, isLot: false, status: 'In QC' }).sort({ _id: 1 }).lean();
}

// The serials QC ticked on a Fail. Returns { error }, or { unitIds, qty }
// (unitIds null for a lot job — the quantity rules as before).
//   qty — what the request asked to reject (null = all that's left)
export async function readRejectedSerials(job, rawIds, qty) {
  const pieces = await piecesInQc(job);
  if (!pieces.length) return { unitIds: null, qty };
  let ids = rawIds;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
  ids = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  const inQc = new Set(pieces.map(p => String(p._id)));
  if (!ids.length) {
    // A full fail needs no ticks — every piece left is rejected.
    const all = !(Number(qty) > 0) || Number(qty) >= job.quantity;
    if (all) return { unitIds: [...inQc], qty: job.quantity };
    return { error: 'Tick the serial numbers QC rejected.' };
  }
  if (ids.some(id => !inQc.has(id))) return { error: 'One of the ticked serial numbers isn\'t waiting for QC on this job — refresh the page.' };
  return { unitIds: ids, qty: ids.length };
}

// QC rejected part (or all) of a purchase job. Never throws.
export async function markRejected(job, { unitIds = null, qty = 0, rejection = null } = {}) {
  try {
    if (!isPurchaseJob(job)) return;
    const push = rejection?._id ? { $push: { rejections: rejection._id } } : {};
    if (unitIds?.length) {
      await PurchasedUnit.updateMany({ _id: { $in: unitIds }, status: 'In QC' }, { $set: { status: 'QC rejected', rejectedQty: 1 }, ...push });
      return;
    }
    const lot = await PurchasedUnit.findOne({ purchaseRequest: job.purchaseRequestId, isLot: true });
    if (!lot) return;
    lot.rejectedQty = Math.round(((lot.rejectedQty || 0) + (Number(qty) || 0)) * 1000) / 1000;
    if (rejection?._id) lot.rejections.push(rejection._id);
    lot.status = lot.rejectedQty + 1e-9 >= lot.lotQty ? 'QC rejected' : 'Part rejected';
    await lot.save();
  } catch (err) {
    console.error('Marking rejected serial numbers failed:', err.message);
  }
}

// QC passed what was left of a purchase job. Never throws.
export async function markAccepted(job) {
  try {
    if (!isPurchaseJob(job)) return;
    await PurchasedUnit.updateMany({ purchaseRequest: job.purchaseRequestId, isLot: false, status: 'In QC' }, { $set: { status: 'Accepted', acceptedQty: 1 } });
    const lot = await PurchasedUnit.findOne({ purchaseRequest: job.purchaseRequestId, isLot: true });
    if (lot) {
      lot.acceptedQty = Number(job.acceptedQty ?? job.quantity) || 0;
      lot.status = (lot.rejectedQty || 0) > 0 ? 'Part rejected' : 'Accepted';
      await lot.save();
    }
  } catch (err) {
    console.error('Marking accepted serial numbers failed:', err.message);
  }
}

// ── Lists ──────────────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listUnits({ companyId, search = '', status = '', kind = '', page = 1, limit = 50 }) {
  const q = { companyId };
  if (status && status !== 'all') q.status = status;
  if (kind === 'serial') q.isLot = false;
  if (kind === 'lot') q.isLot = true;
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(escapeRe(s), 'i');
    q.$or = [{ serialKey: new RegExp(escapeRe(s.toUpperCase())) }, { itemName: re }, { vendorName: re }, { poNumber: re }];
  }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const pg = Math.max(Number(page) || 1, 1);
  const [rows, total] = await Promise.all([
    PurchasedUnit.find(q).sort({ receivedAt: -1, _id: 1 }).skip((pg - 1) * lim).limit(lim)
      .populate('rejections', 'number status outcome').lean(),
    PurchasedUnit.countDocuments(q),
  ]);
  // Vendor warranty claims on each unit (Part 2, 2026-10-13).
  const { claimsByUnit } = await import('./vendorWarrantyClaimService.js');
  const claims = await claimsByUnit(companyId, rows.map(r => r._id));
  for (const r of rows) r.claims = claims.get(String(r._id)) || null;
  return { rows, total, page: pg, limit: lim };
}
