import mongoose from 'mongoose';
const uri = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
await mongoose.connect(uri);
const db = mongoose.connection.db;
const user = await db.collection('users').findOne({ email: 'testaccounthead@gmail.com' });
console.log(JSON.stringify({ username: user?.username, role: user?.role, permissions: user?.permissions }, null, 2));
await mongoose.disconnect();
