/**
 * One-time migration script
 * A bug in createSalesInvoice's "dual billing" number-reuse logic (now fixed
 * — see salesAccountController.js) caused real Kachha/Pakka Sale documents
 * to inherit Store's internal placeholder TEMP-{orderCode}-{timestamp}
 * invoice number instead of a proper generated one. This:
 *   1. Removes exact duplicate real invoices for the same order (identical
 *      invoiceNumber + invoiceType + order — a symptom of the same bug
 *      firing twice), keeping the earliest one.
 *   2. Assigns every remaining TEMP-numbered real (non-placeholder) Sale a
 *      proper invoice number, following the same INV-{timestamp}-{random}
 *      convention the Sale model's own pre-save hook uses when no number is
 *      supplied.
 *
 * Run: node scripts/fixCorruptedTempInvoiceNumbers.js
 */

import connectDB from '../config/database.js';
import Sale from '../models/Sale.js';

const genInvoiceNumber = () => `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

export const fixCorruptedTempInvoiceNumbers = async () => {
  const results = { duplicatesRemoved: [], renumbered: [], errors: [] };

  // 1. De-duplicate: same order + same invoiceType + same (corrupted) invoiceNumber
  const corrupted = await Sale.find({ invoiceNumber: /^TEMP-/, isPlaceholder: { $ne: true } })
    .sort({ createdAt: 1 });

  const seen = new Map(); // key: order|invoiceType -> first Sale doc
  for (const sale of corrupted) {
    const key = `${sale.order}|${sale.invoiceType}`;
    if (!seen.has(key)) {
      seen.set(key, sale);
      continue;
    }
    // Duplicate — remove it, keep the first-seen (earliest) one
    try {
      await Sale.deleteOne({ _id: sale._id });
      results.duplicatesRemoved.push({ id: sale._id, order: sale.order, invoiceType: sale.invoiceType, invoiceNumber: sale.invoiceNumber });
    } catch (err) {
      results.errors.push({ id: sale._id, step: 'dedupe', error: err.message });
    }
  }

  // 2. Renumber whatever real TEMP-numbered Sales remain
  const remaining = await Sale.find({ invoiceNumber: /^TEMP-/, isPlaceholder: { $ne: true } });
  for (const sale of remaining) {
    try {
      const oldNumber = sale.invoiceNumber;
      let newNumber = genInvoiceNumber();
      // Guard against an (astronomically unlikely) collision
      while (await Sale.findOne({ invoiceNumber: newNumber })) {
        newNumber = genInvoiceNumber();
      }
      sale.invoiceNumber = newNumber;
      await sale.save();
      results.renumbered.push({ id: sale._id, order: sale.order, invoiceType: sale.invoiceType, oldNumber, newNumber });
    } catch (err) {
      results.errors.push({ id: sale._id, step: 'renumber', error: err.message });
    }
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes('fixCorruptedTempInvoiceNumbers')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting corrupted TEMP invoice number fix...');
      const results = await fixCorruptedTempInvoiceNumbers();
      console.log('✅ Fix complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Fix failed:', err);
      process.exit(1);
    }
  })();
}
