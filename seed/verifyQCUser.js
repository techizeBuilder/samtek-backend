import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const MONGODB_URI = 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to:', MONGODB_URI.split('@')[1]);

  const user = await User.findOne({ email: 'qchead@gmail.com' }).lean();
  if (!user) {
    console.log('❌ User NOT FOUND in database');
  } else {
    console.log('✅ User found:');
    console.log('  email:', user.email);
    console.log('  username:', user.username);
    console.log('  role:', user.role);
    console.log('  isActive:', user.isActive);
    console.log('  companyId:', user.companyId);
    console.log('  passwordHash length:', user.password?.length);

    // Test password
    const match = await bcrypt.compare('123456', user.password);
    console.log('  password "123456" matches:', match);
  }

  // Also list all users
  const all = await User.find({}, 'email role isActive').lean();
  console.log('\nAll users in DB:', all.length);
  all.forEach(u => console.log(' ', u.email, '|', u.role, '|', u.isActive ? 'active' : 'INACTIVE'));

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(e => { console.error(e); process.exit(1); });
