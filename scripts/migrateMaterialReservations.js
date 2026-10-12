/**
 * One-time migration — material reservation pipeline fix (2026-10-09)
 *
 * MaterialReservation rows now carry the fabrication SIZE
 * (dimensionVariantId), a lineKey (so one order's lines can't overwrite each
 * other) and issuedQuantity (what Store already transferred — a row now means
 * "still to be issued"). This brings the existing rows in line:
 *
 *  1. Rows whose order no longer exists, or already Completed, are deleted
 *     (dev hard-deletes left 24 of them).
 *  2. Old index { item, company } → { item, dimensionVariantId, company }.
 *  3. Every remaining old row (no lineKey yet):
 *     - size: a fabrication item's row gets its size from the order's own
 *       material demand for that item, or the item's only catalog size;
 *       if it still can't be told, the row is reported and deleted (dev data)
 *     - lineKey: the same key the reservation code now writes for that kind
 *       of line (plain / Child Part / Sub Child Part / length / sheet / raw)
 *     - issuedQuantity: what the order's demands for that item already show
 *       as transferred (a job-work order that was already sent: all of it)
 *
 * Dry run by default — prints what it would do. --apply to write.
 * Needs the real MONGODB_URI (server/.env).
 * Run: node scripts/migrateMaterialReservations.js [--apply]
 */

import connectDB from '../config/database.js';
import MaterialReservation from '../models/MaterialReservation.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { Item } from '../models/Inventory.js';
import { sweepStaleReservations } from '../services/materialReservationService.js';

export async function migrateMaterialReservations({ apply = false } = {}) {
  const log = [];

  // 1. Stale rows.
  const stale = await sweepStaleReservations({ apply });
  log.push(`${apply ? 'DELETED' : 'WOULD DELETE'} ${stale.stale} stale row(s) of ${stale.checked} (order gone or Completed)`);

  // 2. Indexes.
  const indexes = await MaterialReservation.collection.indexes();
  const old = indexes.find(ix => JSON.stringify(ix.key) === JSON.stringify({ item: 1, company: 1 }));
  if (old) {
    log.push(`${apply ? 'DROP' : 'WOULD DROP'} index ${old.name}`);
    if (apply) await MaterialReservation.collection.dropIndex(old.name);
  }

  // 3. Old rows (no lineKey yet).
  const rows = await MaterialReservation.find({ $or: [{ lineKey: { $exists: false } }, { lineKey: null }] }).lean();
  let updated = 0;
  let removed = 0;
  for (const r of rows) {
    if (!apply && stale.stale && !(await orderAlive(r))) continue; // already counted as stale
    const item = await Item.findById(r.item).select('code name productKind dimensionVariants').lean();
    const order = r.reservedByOrderModel === 'SubChildPartJobWorkOrder'
      ? await SubChildPartJobWorkOrder.findById(r.reservedByOrderId).select('orderId rounds rawMaterial').lean()
      : await ProductionOrder.findById(r.reservedByOrderId).select('orderId materialDemands').lean();
    if (!item || !order) continue;
    const catalog = (item.dimensionVariants || []).filter(v => !v.isLeftover);
    const isFab = catalog.length > 0;
    const demands = (order.materialDemands || []).filter(d => (d.sourceItemCode || d.materialCode) === item.code);

    let variantId = null;
    if (isFab) {
      const fromDemand = [...new Set(demands.map(d => d.dimensionVariantId).filter(Boolean).map(String))];
      if (fromDemand.length === 1) variantId = fromDemand[0];
      else if (catalog.length === 1) variantId = String(catalog[0]._id);
      if (!variantId) {
        log.push(`${apply ? 'DELETE' : 'WOULD DELETE'} ${item.name} [${item.code}] on ${order.orderId}: can't tell which size (dev data)`);
        if (apply) await MaterialReservation.deleteOne({ _id: r._id });
        removed++;
        continue;
      }
    }

    let lineKey;
    if (r.reservedByOrderModel === 'SubChildPartJobWorkOrder') lineKey = `raw:${demands[0]?.materialCode || item.code}`;
    else if (item.productKind === 'ChildPart') lineKey = `cp:${item.code}`;
    else if (item.productKind === 'SubChildPart') lineKey = `scp:${item.code}`;
    else if (isFab) {
      const d = demands.find(x => String(x.dimensionVariantId) === String(variantId));
      const hasCut = d?.bomDimensions && Object.keys(d.bomDimensions).length > 0;
      lineKey = hasCut || !d ? `length:${item.code}#${variantId}` : `sheet:${d.materialCode}`;
    } else lineKey = `plain:${item.code}`;

    let issued = 0;
    if (r.reservedByOrderModel === 'SubChildPartJobWorkOrder') {
      issued = (order.rounds || []).length > 0 ? r.quantity : 0;
    } else if (!isFab) {
      issued = Math.min(r.quantity, demands.reduce((s, d) => s + (Number(d.transferredQuantity) || 0), 0));
    } else {
      // Whole catalog pieces / sheets only (a flat demand) — a cut demand's
      // pieces aren't in the reservation's unit; left at 0 (safe direction).
      issued = Math.min(r.quantity, demands
        .filter(d => String(d.dimensionVariantId) === String(variantId) && !(d.bomDimensions && Object.keys(d.bomDimensions).length))
        .reduce((s, d) => s + (Number(d.transferredQuantity) || 0), 0));
    }

    log.push(`${apply ? 'SET' : 'WOULD SET'} ${item.name} [${item.code}] on ${order.orderId}: ${isFab ? `size ${variantId}, ` : ''}line ${lineKey}, reserved ${r.quantity}, issued ${issued}`);
    if (apply) {
      await MaterialReservation.updateOne({ _id: r._id }, { $set: { dimensionVariantId: variantId, lineKey, issuedQuantity: issued } });
    }
    updated++;
  }

  if (apply) {
    await MaterialReservation.createIndexes();
    log.push('CREATE index { item, dimensionVariantId, company }');
  }
  return { apply, staleRemoved: stale.stale, oldRows: rows.length, updated, removed, log };
}

async function orderAlive(r) {
  const Model = r.reservedByOrderModel === 'SubChildPartJobWorkOrder' ? SubChildPartJobWorkOrder : ProductionOrder;
  return !!(await Model.exists({ _id: r.reservedByOrderId, status: { $ne: 'Completed' } }));
}

if (process.argv[1].includes('migrateMaterialReservations')) {
  (async () => {
    try {
      await connectDB();
      const apply = process.argv.includes('--apply');
      console.log(apply ? '🔄 Migrating material reservations…' : '🔍 Dry run — nothing will be written (use --apply)…');
      const result = await migrateMaterialReservations({ apply });
      for (const line of result.log) console.log('  ' + line);
      const { log, ...summary } = result;
      console.log('✅ Done:', JSON.stringify(summary, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Failed:', err);
      process.exit(1);
    }
  })();
}
