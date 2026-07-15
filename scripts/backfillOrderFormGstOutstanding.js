/**
 * One-time migration script
 * The Order Form's outstanding contribution used to be computed as just
 * (Bill Amount - Advance), missing the GST Amount. It should be
 * (Bill Amount + GST Amount - Advance). This recomputes the correct
 * contribution for every already-Submitted Order Form and adjusts each
 * linked Customer's outstandingAmount by the delta, so existing customers'
 * Outstanding reflects GST immediately instead of waiting for a resubmit.
 *
 * Run: node scripts/backfillOrderFormGstOutstanding.js
 */

import mongoose from 'mongoose';
import connectDB from '../config/database.js';
import OrderForm from '../models/OrderForm.js';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import Customer from '../models/Customer.js';

export const backfillOrderFormGstOutstanding = async () => {
  const results = {
    total: 0,
    unchanged: 0,
    updated: 0,
    skippedNoOrder: [],
    errors: [],
  };

  const forms = await OrderForm.find({ status: 'Submitted' });
  results.total = forms.length;

  for (const form of forms) {
    try {
      const order = await Order.findById(form.orderId).select('leadId customer');
      if (!order) {
        results.skippedNoOrder.push({ formId: form._id, orderId: form.orderId });
        continue;
      }

      let advancePaid = 0;
      if (order.leadId) {
        const lead = await Lead.findById(order.leadId).select('advancedPaymentAmount');
        advancePaid = lead?.advancedPaymentAmount || 0;
      }

      const billAmount = form.totals?.billAmount || 0;
      const gstAmount = form.totals?.gstAmount || 0;
      const correctContribution = Math.max(0, billAmount + gstAmount - advancePaid);
      const oldContribution = form.outstandingContribution || 0;
      const delta = correctContribution - oldContribution;

      if (delta === 0) {
        results.unchanged++;
        continue;
      }

      if (order.customer) {
        await Customer.findByIdAndUpdate(order.customer, {
          $inc: { outstandingAmount: delta },
        });
      }

      form.outstandingContribution = correctContribution;
      await form.save();
      results.updated++;
    } catch (err) {
      results.errors.push({ formId: form._id, error: err.message });
    }
  }

  return results;
};

// Run directly if executed as a script
if (process.argv[1].includes('backfillOrderFormGstOutstanding')) {
  (async () => {
    try {
      await connectDB();
      console.log('🔄 Starting Order Form GST-outstanding backfill...');
      const results = await backfillOrderFormGstOutstanding();
      console.log('✅ Backfill complete:', JSON.stringify(results, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Backfill failed:', err);
      process.exit(1);
    }
  })();
}
