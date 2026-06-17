
const mongoose = require('mongoose');
const { Schema } = mongoose;

const leadSchema = new Schema({}, { strict: false });
const Lead = mongoose.model('Lead', leadSchema);

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  
  const leads = await Lead.find({}, { _id: 1, history: 1, notes: 1, documents: 1, describeRequirements: 1 }).sort({ createdAt: -1 }).limit(20);
  let totalSize = 0;
  leads.forEach((l, i) => {
    const size = Buffer.byteLength(JSON.stringify(l), 'utf8');
    totalSize += size;
    console.log('Lead', i, 'Size:', (size / 1024 / 1024).toFixed(2), 'MB');
  });
  console.log('Total Size:', (totalSize / 1024 / 1024).toFixed(2), 'MB');
  process.exit(0);
}
test().catch(console.error);
