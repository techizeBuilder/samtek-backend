
const mongoose = require('mongoose');
const { Schema } = mongoose;

mongoose.set('debug', true);

const leadSchema = new Schema({}, { strict: false });
const Lead = mongoose.model('Lead', leadSchema);

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  
  const start = Date.now();
  console.log('Running find...');
  const leads = await Lead.find({}).sort({ createdAt: -1 }).limit(20);
  console.log('Got leads:', leads.length);
  console.log('Time taken:', Date.now() - start, 'ms');
  process.exit(0);
}
test().catch(console.error);
