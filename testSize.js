
const mongoose = require('mongoose');
const { Schema } = mongoose;

const leadSchema = new Schema({}, { strict: false });
const Lead = mongoose.model('Lead', leadSchema);

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  
  const leads = await Lead.find({}).sort({ createdAt: -1 }).limit(20);
  console.log('Got leads:', leads.length);
  leads.forEach((l, i) => {
    console.log('Lead', i, 'history length:', l.get('history') ? l.get('history').length : 0);
  });
  process.exit(0);
}
test().catch(console.error);
