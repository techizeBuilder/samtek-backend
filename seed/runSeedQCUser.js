import mongoose from 'mongoose';
import { seedQCUser } from './seedQCUser.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin';

const run = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected. Creating QC Head user...\n');

    const result = await seedQCUser();
    console.log('\nResult:', JSON.stringify(result, null, 2));

    await mongoose.disconnect();
    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
};

run();
