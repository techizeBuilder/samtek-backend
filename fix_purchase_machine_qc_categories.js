/**
 * One-time migration script:
 * Fixes QC jobs that were incorrectly stored with category "Raw Material"
 * for items that are actually "Purchase Machine" or "Manufacturing Machine".
 *
 * Run: node fix_purchase_machine_qc_categories.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const QCJob = mongoose.model('QCJob', new mongoose.Schema({}, { strict: false }));
  const Item  = mongoose.model('Item',  new mongoose.Schema({}, { strict: false }));

  const MACHINE_CATEGORIES = ['Purchase Machine', 'Manufacturing Machine'];

  // Find all Purchase source QC jobs whose category is NOT a machine category
  const badJobs = await QCJob.find({
    source: 'Purchase',
    category: { $nin: MACHINE_CATEGORIES }
  }).lean();

  console.log(`Found ${badJobs.length} Purchase QC job(s) with potentially wrong category`);

  let fixed = 0;
  let skipped = 0;

  for (const job of badJobs) {
    let inventoryItem = null;

    // Try by itemCode as ObjectId
    if (job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
      inventoryItem = await Item.findById(job.itemCode).lean();
    }

    // Try by code + store
    if (!inventoryItem && job.itemCode) {
      inventoryItem = await Item.findOne({
        code: job.itemCode,
        store: job.company?.toString()
      }).lean();
    }

    // Try by name + store
    if (!inventoryItem && job.itemName) {
      inventoryItem = await Item.findOne({
        name: { $regex: new RegExp(`^${job.itemName.trim()}$`, 'i') },
        store: job.company?.toString()
      }).lean();
    }

    // Try by name without store filter (last resort)
    if (!inventoryItem && job.itemName) {
      inventoryItem = await Item.findOne({
        name: { $regex: new RegExp(`^${job.itemName.trim()}$`, 'i') }
      }).lean();
    }

    if (inventoryItem && MACHINE_CATEGORIES.includes(inventoryItem.category)) {
      await QCJob.updateOne(
        { _id: job._id },
        { $set: { category: inventoryItem.category } }
      );
      console.log(`✅ Fixed QC Job ${job.qcJobId}: "${job.category}" → "${inventoryItem.category}" (item: ${job.itemName})`);
      fixed++;
    } else {
      console.log(`⏭  Skipped QC Job ${job.qcJobId}: item "${job.itemName}" is genuinely not a machine (category: ${inventoryItem?.category || 'not found'})`);
      skipped++;
    }
  }

  console.log(`\n🎯 Done. Fixed: ${fixed}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
