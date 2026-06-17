const mongoose = require('mongoose');

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
  
  const orders = await Order.find({}).sort({ createdAt: -1 }).limit(20);
  console.log('Got orders:', orders.length);
  
  let totalSize = 0;
  orders.forEach((o, i) => {
    const obj = o.toObject();
    const size = Buffer.byteLength(JSON.stringify(obj), 'utf8');
    totalSize += size;
    console.log(`Order #${obj.orderCode || obj._id} Size: ${(size / 1024).toFixed(2)} KB`);
    
    // Check sizes of individual fields
    for (const key in obj) {
      const fieldSize = Buffer.byteLength(JSON.stringify(obj[key] || ''), 'utf8');
      if (fieldSize > 1024) {
        console.log(`  - Field '${key}': ${(fieldSize / 1024).toFixed(2)} KB`);
      }
    }
  });
  
  console.log(`Total Size of 20 orders: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  process.exit(0);
}
test().catch(console.error);
