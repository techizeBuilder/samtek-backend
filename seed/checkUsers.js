import mongoose from 'mongoose';
import User from '../models/User.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp';

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  const users = await User.find({}, 'email role isActive fullName').lean();
  console.log('Total users:', users.length);
  if (users.length === 0) {
    console.log('NO USERS FOUND — database may be empty!');
  } else {
    users.forEach(u => console.log(`  ${(u.email || 'no-email').padEnd(35)} | ${(u.role || 'no-role').padEnd(30)} | ${u.isActive ? 'active' : 'INACTIVE'}`));
  }
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(e => { console.error(e.message); process.exit(1); });
