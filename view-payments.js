import mongoose from 'mongoose';
import LeadPayment from './models/LeadPayment.js';
import Lead from './models/Lead.js';

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/samtek');
  try {
    const payments = await LeadPayment.find({ leadCode: 'LD-0006' }).lean();
    console.log(`Found ${payments.length} payments for LD-0006:`);
    payments.forEach((p, idx) => {
      console.log(`\nPayment ${idx + 1}:`);
      console.log(`  ID: ${p._id}`);
      console.log(`  Amount: ${p.amount}`);
      console.log(`  Method: ${p.paymentMethod}`);
      console.log(`  BankAccount ID: ${p.bankAccount}`);
      console.log(`  Status: ${p.status}`);
      console.log(`  Created At: ${p.createdAt}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
  }
};

run();
