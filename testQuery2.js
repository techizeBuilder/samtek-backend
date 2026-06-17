
const mongoose = require('mongoose');
const { Schema } = mongoose;

const leadSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId },
  createdAt: { type: Date }
}, { strict: false });
const Lead = mongoose.model('Lead', leadSchema);

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  const count = await Lead.countDocuments();
  console.log('Total Leads:', count);
  
  const start = Date.now();
  const leads = await Lead.find({}).sort({ createdAt: -1 }).limit(20);
  console.log('Got leads:', leads.length);
  console.log('Time taken:', Date.now() - start, 'ms');
  process.exit(0);
}
test().catch(console.error);
