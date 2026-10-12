/**
 * One-time migration script — Vendor Master v2 (procurement-v2, 2026-10-08)
 *
 * Vendors now need Company Admin approval before they can be quoted or given
 * a PO (Supplier.approvalStatus, default 'Draft'). Vendors created before
 * that field existed have no approvalStatus in the database, so every
 * "approved vendors only" query would silently drop them. They were already
 * in use (quoted, on POs), so they're grandfathered as 'Approved', with an
 * activity entry saying so.
 *
 * Safe to run multiple times — only touches vendors still missing
 * approvalStatus.
 *
 * Needs the real database URI in MONGODB_URI (config/database.js's own
 * fallback is not the live database).
 * Run: node scripts/backfillSupplierApprovalStatus.js
 */

import connectDB from '../config/database.js';
import Supplier from '../models/Supplier.js';

export const backfillSupplierApprovalStatus = async () => {
  const now = new Date();
  const missing = { approvalStatus: { $exists: false } };
  const total = await Supplier.countDocuments(missing);
  // Raw collection update — skips document validation, so an older vendor
  // with some other legacy gap still gets its approval status.
  const result = await Supplier.collection.updateMany(missing, {
    $set: { approvalStatus: 'Approved', approvedAt: now },
    $push: {
      activity: {
        action: 'Approved (grandfathered)',
        by: null,
        byName: 'System',
        at: now,
        remarks: 'Existed before vendor approval was introduced (2026-10-08)',
      },
    },
  });
  const stillMissing = await Supplier.countDocuments(missing);
  return { found: total, updated: result.modifiedCount, stillMissing };
};

if (process.argv[1].includes('backfillSupplierApprovalStatus')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting Supplier approvalStatus backfill...');
      const results = await backfillSupplierApprovalStatus();
      console.log('✅ Backfill complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Backfill failed:', err);
      process.exit(1);
    }
  })();
}
