/**
 * Diagnostic + Fix script for duplicate Sale records per order.
 * Run: node fix_duplicate_sales.js
 * 
 * Step 1 (dry-run): node fix_duplicate_sales.js
 * Step 2 (apply):   node fix_duplicate_sales.js --fix
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const APPLY_FIX = process.argv.includes('--fix');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const Sale = mongoose.model('Sale', new mongoose.Schema({}, { strict: false }), 'sales');
  const Customer = mongoose.model('Customer', new mongoose.Schema({}, { strict: false }), 'customers');

  // Find all orders that have more than 1 Sale record
  const duplicates = await Sale.aggregate([
    { $match: { order: { $exists: true, $ne: null } } },
    { $group: { _id: '$order', count: { $sum: 1 }, ids: { $push: '$_id' }, invoiceNumbers: { $push: '$invoiceNumber' }, balances: { $push: '$balanceAmount' }, totals: { $push: '$totalAmount' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]);

  console.log(`Found ${duplicates.length} order(s) with duplicate Sale records:\n`);

  let totalRemoved = 0;

  for (const dup of duplicates) {
    console.log(`Order: ${dup._id}`);
    console.log(`  Sale IDs: ${dup.ids.map(id => id.toString()).join(', ')}`);
    console.log(`  Invoice Numbers: ${dup.invoiceNumbers.join(', ')}`);
    console.log(`  Balance Amounts: ${dup.balances.join(', ')}`);
    console.log(`  Total Amounts: ${dup.totals.join(', ')}`);

    if (APPLY_FIX) {
      // Keep the Sale with the largest totalAmount (the actual invoice)
      // Remove the smaller/duplicate ones
      const sales = await Sale.find({ _id: { $in: dup.ids } }).lean();
      sales.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0));

      const keep = sales[0];
      const remove = sales.slice(1);

      console.log(`  ✅ Keeping: ${keep._id} (invoice: ${keep.invoiceNumber}, total: ${keep.totalAmount}, balance: ${keep.balanceAmount})`);
      
      for (const r of remove) {
        console.log(`  🗑  Removing: ${r._id} (invoice: ${r.invoiceNumber}, total: ${r.totalAmount}, balance: ${r.balanceAmount})`);
        await Sale.deleteOne({ _id: r._id });
        totalRemoved++;
      }

      // Recalculate customer outstanding after cleanup
      if (keep.customer) {
        const remainingSales = await Sale.find({ customer: keep.customer, balanceAmount: { $gt: 0 } }).lean();
        const newOutstanding = remainingSales.reduce((sum, s) => sum + (s.balanceAmount || 0), 0);
        await Customer.findByIdAndUpdate(keep.customer, { outstandingAmount: newOutstanding });
        console.log(`  💰 Updated customer outstanding: ₹${newOutstanding.toLocaleString('en-IN')}`);
      }
    }
    console.log('');
  }

  if (APPLY_FIX) {
    console.log(`\n🎯 Done. Removed ${totalRemoved} duplicate Sale record(s).`);
  } else {
    console.log(`\n⚠️  DRY RUN — no changes made.`);
    console.log(`   To apply fixes, run: node fix_duplicate_sales.js --fix`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
