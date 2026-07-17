/**
 * One-time migration script
 * Sale.isPlaceholder is a new field marking Store's internal auto-created
 * Sale records (see orderController.js updateOrderStoreInfo) as NOT real
 * invoices. Existing placeholder Sales predate this field, so this backfills
 * isPlaceholder: true for them.
 *
 * Only Sales that match BOTH signatures of the auto-created placeholder are
 * touched — the TEMP- invoiceNumber prefix AND the exact auto-generated
 * notes text. This deliberately excludes the ~19 real Kachha/Pakka invoices
 * that (due to a separate bug in createSalesInvoice's "dual billing" reuse
 * logic, now fixed) inherited a TEMP- invoiceNumber from the placeholder —
 * those are real invoices with a wrong number, not placeholders, and must
 * NOT be flagged here. See backfillProductionOrderCode.js siblings for the
 * reuse-logic fix in salesAccountController.js.
 *
 * Run: node scripts/backfillSalePlaceholderFlag.js
 */

import connectDB from '../config/database.js';
import Sale from '../models/Sale.js';

const AUTO_CREATED_NOTES = /^Auto-created from Order .* for store management$/;

export const backfillSalePlaceholderFlag = async () => {
  const candidates = await Sale.find({
    invoiceNumber: /^TEMP-/,
    isPlaceholder: { $ne: true },
  }).select('invoiceNumber notes').lean();

  const toFlag = candidates.filter(s => AUTO_CREATED_NOTES.test(s.notes || ''));
  const skipped = candidates.filter(s => !AUTO_CREATED_NOTES.test(s.notes || ''));

  const result = await Sale.updateMany(
    { _id: { $in: toFlag.map(s => s._id) } },
    { $set: { isPlaceholder: true } }
  );

  return {
    totalTempInvoiceNumbers: candidates.length,
    flaggedAsPlaceholder: result.modifiedCount,
    skippedLikelyRealInvoices: skipped.map(s => ({ id: s._id, invoiceNumber: s.invoiceNumber, notes: s.notes })),
  };
};

// Run directly if executed as a script
if (process.argv[1].includes('backfillSalePlaceholderFlag')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting Sale.isPlaceholder backfill...');
      const results = await backfillSalePlaceholderFlag();
      console.log('✅ Backfill complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Backfill failed:', err);
      process.exit(1);
    }
  })();
}
