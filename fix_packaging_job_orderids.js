/**
 * Migration script: Fix PackagingJob.orderId to use sales Order.orderCode
 *
 * Problem: Existing PackagingJob records have orderId set to ProductionOrder.orderId
 * (e.g. "MFG-2024-XXX-001") instead of the linked sales Order.orderCode (e.g. "ORD-2024-XXX-001").
 * This causes them to NOT appear in Accounts > NOC Request and Packed Order Payment pages.
 *
 * Run: node fix_packaging_job_orderids.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const PackagingJobSchema = new mongoose.Schema({}, { strict: false });
const ProductionOrderSchema = new mongoose.Schema({}, { strict: false });
const SaleSchema = new mongoose.Schema({}, { strict: false });
const OrderSchema = new mongoose.Schema({}, { strict: false });

const PackagingJob = mongoose.model('PackagingJob', PackagingJobSchema, 'packagingjobs');
const ProductionOrder = mongoose.model('ProductionOrder', ProductionOrderSchema, 'productionorders');
const Sale = mongoose.model('Sale', SaleSchema, 'sales');
const Order = mongoose.model('Order', OrderSchema, 'orders');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB\n');

  // Get all packaging jobs that have a productionOrderId (these are the ones at risk)
  const jobs = await PackagingJob.find({ productionOrderId: { $exists: true, $ne: null } }).lean();
  console.log(`Found ${jobs.length} packaging jobs with a productionOrderId\n`);

  let fixed = 0;
  let skipped = 0;
  let alreadyCorrect = 0;

  for (const job of jobs) {
    const prodOrder = await ProductionOrder.findById(job.productionOrderId).select('orderId saleId').lean();
    if (!prodOrder) {
      console.log(`  SKIP job ${job.jobId || job._id}: productionOrder not found`);
      skipped++;
      continue;
    }

    if (!prodOrder.saleId) {
      console.log(`  SKIP job ${job.jobId || job._id}: productionOrder has no saleId (Stock production, no sales order)`);
      skipped++;
      continue;
    }

    const sale = await Sale.findById(prodOrder.saleId).select('order').lean();
    if (!sale?.order) {
      console.log(`  SKIP job ${job.jobId || job._id}: sale has no linked order`);
      skipped++;
      continue;
    }

    const salesOrder = await Order.findById(sale.order).select('orderCode').lean();
    if (!salesOrder?.orderCode) {
      console.log(`  SKIP job ${job.jobId || job._id}: sales order has no orderCode`);
      skipped++;
      continue;
    }

    const correctOrderId = salesOrder.orderCode;

    if (job.orderId === correctOrderId) {
      console.log(`  OK   job ${job.jobId || job._id}: orderId already correct (${correctOrderId})`);
      alreadyCorrect++;
      continue;
    }

    // Fix it
    await PackagingJob.updateOne({ _id: job._id }, { $set: { orderId: correctOrderId } });
    console.log(`  FIXED job ${job.jobId || job._id}: "${job.orderId}" → "${correctOrderId}"`);
    fixed++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Already correct : ${alreadyCorrect}`);
  console.log(`Fixed           : ${fixed}`);
  console.log(`Skipped         : ${skipped}`);
  console.log(`\nDone.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
