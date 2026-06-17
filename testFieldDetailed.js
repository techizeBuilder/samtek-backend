
const mongoose = require('mongoose');
const { Schema } = mongoose;

const leadSchema = new Schema({}, { strict: false });
const Lead = mongoose.model('Lead', leadSchema);

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  
  const leads = await Lead.find({}).sort({ createdAt: -1 }).limit(1);
  const l = leads[0].toObject();
  for (const key in l) {
    const size = Buffer.byteLength(JSON.stringify(l[key] || ''), 'utf8');
    if (size > 10000) {
      console.log('Huge Field:', key, (size / 1024).toFixed(2), 'KB');
    }
  }
  process.exit(0);
}
test().catch(console.error);
