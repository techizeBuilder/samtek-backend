const mongoose = require('mongoose');

async function test() {
  await mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin');
  console.log('Connected');
  
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
  
  // Find orders that have a quotation field and measure its size
  const orders = await Order.find({ quotation: { $exists: true, $ne: null } }, { orderCode: 1, quotation: 1 });
  console.log('Orders with quotation:', orders.length);
  
  orders.forEach(o => {
    const quote = o.get('quotation') || '';
    const size = Buffer.byteLength(quote, 'utf8');
    console.log(`Order #${o.get('orderCode') || o._id} - Quotation Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  });
  
  process.exit(0);
}
test().catch(console.error);
