/**
 * One-time cleanup — procurement-v2 (2026-10-08)
 *
 * Payment terms (Advance/Balance %, Credit Days, Notes), GST Rate and the
 * automatic Charges list used to be stored on each vendor. They're decided per
 * order now and entered on the PO; the fields were removed from Supplier.js
 * and their readers rewritten. This removes the leftover old data from the
 * vendor documents (user decision: "those are old system data so we will drop
 * them"). Old POs keep their own copies, untouched.
 *
 * Safe to run more than once. Run with --dry-run to only count.
 * Needs the real MONGODB_URI (server/.env).
 * Run: node scripts/dropVendorCommercialFields.js [--dry-run]
 */

import connectDB from '../config/database.js';
import Supplier from '../models/Supplier.js';

const FIELDS = ['paymentAdvancePercent', 'paymentBalancePercent', 'creditDays', 'paymentNotes', 'gstRate', 'charges'];

export const dropVendorCommercialFields = async ({ dryRun = false } = {}) => {
  const anyPresent = { $or: FIELDS.map(f => ({ [f]: { $exists: true } })) };
  const perField = {};
  for (const f of FIELDS) perField[f] = await Supplier.collection.countDocuments({ [f]: { $exists: true } });
  const vendorsWithAny = await Supplier.collection.countDocuments(anyPresent);
  if (dryRun) return { dryRun: true, vendorsWithAny, perField };
  const result = await Supplier.collection.updateMany(anyPresent, { $unset: Object.fromEntries(FIELDS.map(f => [f, ''])) });
  const stillPresent = await Supplier.collection.countDocuments(anyPresent);
  return { vendorsWithAny, perField, updated: result.modifiedCount, stillPresent };
};

if (process.argv[1].includes('dropVendorCommercialFields')) {
  (async () => {
    try {
      await connectDB();
      const dryRun = process.argv.includes('--dry-run');
      console.log(`🔄 ${dryRun ? 'Counting' : 'Dropping'} vendor commercial fields...`);
      const results = await dropVendorCommercialFields({ dryRun });
      console.log('✅ Done:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Failed:', err);
      process.exit(1);
    }
  })();
}
