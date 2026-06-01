"use strict";
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
await mongoose.connect(process.env.MONGODB_URI);
console.log('✅ Connected to DB:', process.env.MONGODB_URI);
const db = mongoose.connection.db;
// Find all orders with status = 'pending' (service verified)
const pendingOrders = await db.collection('orders').find({ status: 'pending' }).toArray();
console.log(`\n📋 Found ${pendingOrders.length} service-verified (pending) orders:\n`);
pendingOrders.forEach(o => {
    var _a;
    console.log(`  - ${o.orderCode} | status: ${o.status} | serviceVerification: ${((_a = o.serviceVerification) === null || _a === void 0 ? void 0 : _a.status) || 'none'}`);
});
const args = process.argv.slice(2);
if (args.includes('--reset')) {
    const result = await db.collection('orders').updateMany({ status: 'pending' }, {
        $set: { status: 'pending_service_approval' },
        $unset: { serviceVerification: '' }
    });
    console.log(`\n🔄 Reset ${result.modifiedCount} orders back to 'pending_service_approval'`);
}
else {
    console.log('\nℹ️  To reset orders, run: node reset_orders.mjs --reset');
    console.log('ℹ️  To just list orders (current), run without --reset\n');
}
await mongoose.disconnect();
console.log('✅ Done!');
