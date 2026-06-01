"use strict";
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI);
console.log('✅ Connected to DB');
const result = await mongoose.connection.db.collection('orders').updateOne({ orderCode: 'ORD-0013' }, {
    $set: { status: 'pending_service_approval' },
    $unset: { serviceVerification: '' }
});
console.log(`🔄 Reset result: ${result.modifiedCount} order(s) updated`);
const order = await mongoose.connection.db.collection('orders').findOne({ orderCode: 'ORD-0013' });
console.log(`✅ ORD-0013 current status: ${order === null || order === void 0 ? void 0 : order.status}`);
await mongoose.disconnect();
console.log('Done!');
