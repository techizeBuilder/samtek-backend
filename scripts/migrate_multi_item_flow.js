/**
 * One-time migration for the multi-item order flow.
 *
 * 1. Drops the old unique index { company: 1, productionOrderId: 1 } on
 *    packagingjobs — one Production Order with orderQuantity N now packs as
 *    N per-unit jobs, so the unique constraint must go. (The schema now
 *    declares a NON-unique index with the same keys; Mongoose will recreate
 *    it on next startup.)
 * 2. Backfills itemRef on existing Sale.items by matching the linked
 *    Order.products by product name, so legacy sales can be routed per-item.
 *
 * Safe to run multiple times.
 *
 * Run: node scripts/migrate_multi_item_flow.js
 */

import connectDB from '../config/database.js';
import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import { Item } from '../models/Inventory.js';

export const migrateMultiItemFlow = async () => {
  const results = { indexDropped: false, indexAlreadyGone: false, salesBackfilled: 0, errors: [] };

  // ── 1. Drop the old unique packaging index ──
  try {
    const coll = mongoose.connection.db.collection('packagingjobs');
    const indexes = await coll.indexes();
    const oldIdx = indexes.find(ix =>
      ix.key && ix.key.company === 1 && ix.key.productionOrderId === 1 && ix.unique === true
    );
    if (oldIdx) {
      await coll.dropIndex(oldIdx.name);
      results.indexDropped = true;
      console.log(`🗑️  Dropped old unique index '${oldIdx.name}' on packagingjobs`);
    } else {
      results.indexAlreadyGone = true;
      console.log('✔️  Old unique index on packagingjobs already gone');
    }
  } catch (err) {
    results.errors.push(`index: ${err.message}`);
    console.error('❌ Error dropping packaging index:', err.message);
  }

  // ── 2. Backfill Sale.items[].itemRef from the linked Order's products ──
  try {
    const sales = await Sale.find({
      order: { $ne: null },
      'items.0': { $exists: true }
    }).populate({ path: 'order', populate: { path: 'products.product', select: 'name' } });

    for (const sale of sales) {
      let dirty = false;
      for (const it of sale.items || []) {
        if (it.itemRef) continue;
        const match = (sale.order?.products || []).find(p =>
          (p.product?.name || '').trim().toLowerCase() === (it.productName || '').trim().toLowerCase());
        if (match && match.product?._id) {
          it.itemRef = match.product._id;
          dirty = true;
        }
      }
      if (dirty) {
        // validateBeforeSave off: legacy sales may have quirks in unrelated
        // fields; we only touch itemRef here.
        await sale.save({ validateBeforeSave: false });
        results.salesBackfilled++;
      }
    }
    console.log(`✔️  Backfilled itemRef on ${results.salesBackfilled} sale(s)`);
  } catch (err) {
    results.errors.push(`backfill: ${err.message}`);
    console.error('❌ Error backfilling sale itemRefs:', err.message);
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes('migrate_multi_item_flow')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting multi-item flow migration...');
      const results = await migrateMultiItemFlow();
      console.log('✅ Migration complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    }
  })();
}
