import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
console.log('✅ Connected to DB\n');

const db = mongoose.connection.db;

// Check ORD-0013 details
const order = await db.collection('orders').findOne({ orderCode: 'ORD-0013' });
console.log('=== ORD-0013 Details ===');
console.log('Status:', order?.status);
console.log('companyId:', order?.companyId);
console.log('serviceVerification:', JSON.stringify(order?.serviceVerification));
console.log('unit:', order?.unit);
console.log('');

// Check what companies exist in orders
const allOrders = await db.collection('orders').find({ status: 'pending' }).toArray();
console.log('=== All Pending Orders ===');
allOrders.forEach(o => {
  console.log(`${o.orderCode} | status: ${o.status} | companyId: ${o.companyId} | serviceVerification: ${o.serviceVerification?.status || 'none'}`);
});

// Check Sale records linked to orders
const sales = await db.collection('sales').find({}).limit(5).toArray();
console.log('\n=== Sample Sales Records ===');
sales.forEach(s => {
  console.log(`Sale: ${s._id} | order: ${s.order} | companyId: ${s.companyId}`);
});

await mongoose.disconnect();
console.log('\nDone!');
