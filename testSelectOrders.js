const mongoose = require('mongoose');

async function test() {
  const start = Date.now();
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected in', Date.now() - start, 'ms');
  
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
  
  const startCount = Date.now();
  const count = await Order.countDocuments();
  console.log('Total orders count:', count, 'fetched in', Date.now() - startCount, 'ms');

  const startQuery = Date.now();
  // Fetch 20 orders without the quotation field
  const orders = await Order.find({}, { quotation: 0 }).sort({ createdAt: -1 }).limit(20);
  console.log('Got orders without quotation:', orders.length, 'in', Date.now() - startQuery, 'ms');
  
  orders.forEach((o, i) => {
    const obj = o.toObject();
    const size = Buffer.byteLength(JSON.stringify(obj), 'utf8');
    console.log(`Order #${obj.orderCode || obj._id} Size (without quotation): ${(size / 1024).toFixed(2)} KB`);
  });
  
  process.exit(0);
}
test().catch(console.error);
