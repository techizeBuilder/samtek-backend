/**
 * One-time migration script
 * The Production Orders list (Production > Orders) shows an "ORDER ID"
 * column that used to fall back to `machineCode` — which for many rows is
 * actually a product/machine code (e.g. "AFMP001"), not the real sales
 * Order's code (e.g. "ORD-0066"). ProductionOrder now has a dedicated
 * `orderCode` field, populated at creation time for new records. This
 * backfills it for existing records that carry a `saleId`, by resolving
 * Sale.order.orderCode.
 *
 * Run: node scripts/backfillProductionOrderCode.js
 */

import connectDB from '../config/database.js';
import ProductionOrder from '../models/ProductionOrder.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js'; // registers the 'Order' schema so Sale's populate('order') resolves

export const backfillProductionOrderCode = async () => {
  const results = {
    total: 0,
    updated: 0,
    unchanged: 0,
    skippedNoSaleId: 0,
    skippedNoOrder: [],
    errors: [],
  };

  const orders = await ProductionOrder.find({
    saleId: { $ne: null },
    $or: [{ orderCode: null }, { orderCode: { $exists: false } }],
  });
  results.total = orders.length;

  for (const po of orders) {
    try {
      if (!po.saleId) {
        results.skippedNoSaleId++;
        continue;
      }

      const sale = await Sale.findById(po.saleId).populate('order', 'orderCode');
      const orderCode = sale?.order?.orderCode || null;

      if (!orderCode) {
        results.skippedNoOrder.push({ productionOrderId: po._id, orderId: po.orderId, saleId: po.saleId });
        continue;
      }

      po.orderCode = orderCode;
      await po.save();
      results.updated++;
    } catch (err) {
      results.errors.push({ productionOrderId: po._id, error: err.message });
    }
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes('backfillProductionOrderCode')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting Production Order orderCode backfill...');
      const results = await backfillProductionOrderCode();
      console.log('✅ Backfill complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Backfill failed:', err);
      process.exit(1);
    }
  })();
}
