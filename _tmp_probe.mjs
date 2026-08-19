import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const uri = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';
await mongoose.connect(uri);
const db = mongoose.connection.db;
const user = await db.collection('users').findOne({ email: 'testaccounthead@gmail.com' });
await mongoose.disconnect();

const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });

const res = await fetch('http://localhost:5000/api/accounts/packed-orders?status=pending&page=1&limit=10', {
  headers: { Authorization: `Bearer ${token}` }
});
console.log('Status:', res.status);
const body = await res.text();
console.log('Body:', body.slice(0, 2000));
